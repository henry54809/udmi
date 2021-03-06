package com.google.bos.iot.core.proxy;

import static com.google.common.base.Preconditions.checkNotNull;

import com.google.api.services.cloudiot.v1.model.Device;
import com.google.cloud.ServiceOptions;
import com.google.common.base.Joiner;
import com.google.common.collect.Maps;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentSkipListSet;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ProxyTarget {

  private static final String PROJECT_ID = ServiceOptions.getDefaultProjectId();
  private static final Logger LOG = LoggerFactory.getLogger(ProxyTarget.class);

  private static final String EVENTS_TOPIC_FORMAT = "events/%s";
  private static final String CONFIG_TOPIC = "config";
  private static final String DEVICE_TOPIC_PREFIX = "/devices/";
  private static final String STATE_SUBFOLDER = "state";

  static final String STATE_TOPIC = "state";

  private final Map<String, MessagePublisher> messagePublishers = new ConcurrentHashMap<>();
  private final Map<String, String> configMap;
  private final String registryId;
  private final ProxyConfig proxyConfig;
  private final Consumer<MessageBundle> bundleOut;
  private CloudIotConfig cloudConfig;
  private CloudIotManager cloudIotManager;
  private final Set<String> ignoredDevices = new ConcurrentSkipListSet<>();
  private Set<String> targetDevices;

  public ProxyTarget(Map<String, String> configMap, String registryId,
      Consumer<MessageBundle> bundleOut) {
    info("Creating new proxy target for " + registryId);
    this.configMap = configMap;
    this.registryId = registryId;
    this.bundleOut = bundleOut;
    proxyConfig = loadProxyConfig();
    if (proxyConfig == null) {
      info("Ignoring unknown proxy target " + registryId);
      return;
    }
    cloudConfig = loadCloudConfig();
    initialize();
    info("Created proxy target instance for registry " + registryId);
  }

  private void initialize() {
    checkNotNull(cloudConfig.cloud_region,"cloud config cloud_region not defined");
    checkNotNull(cloudConfig.registry_id,"cloud config registry_id not defined");
    checkNotNull(proxyConfig.dstProjectId,"proxy config dstProjectId not defined");
    checkNotNull(proxyConfig.dstCloudRegion,"proxy config dstCloudRegion not defined");

    LOG.info(String.format("Pushing to Cloud IoT registry %s/%s/%s",
        proxyConfig.dstProjectId,proxyConfig.dstCloudRegion, registryId));

    cloudIotManager = new CloudIotManager(PROJECT_ID, cloudConfig);

    targetDevices = cloudIotManager.listDevices();
    LOG.info("Proxying for devices "+Joiner.on(", ").join(targetDevices));
  }

  private ProxyConfig loadProxyConfig() {
    String keyPrefix = getKeyPrefix();
    String regionKey = keyPrefix + "region";
    String targetKey = keyPrefix + "target";
    if (!configMap.containsKey(targetKey)) {
      LOG.warn("Proxy target key not found: " + targetKey);
      return null;
    }
    if (!configMap.containsKey(regionKey)) {
      LOG.warn("Proxy region key not found: " + regionKey);
      return null;
    }
    ProxyConfig proxyConfig = new ProxyConfig();
    proxyConfig.dstProjectId = configMap.get(targetKey);
    proxyConfig.dstCloudRegion = configMap.get(regionKey);
    return proxyConfig;
  }

  private String getKeyPrefix() {
    return String.format("proxy_%s_", registryId);
  }

  private CloudIotConfig loadCloudConfig() {
    CloudIotConfig cloudIotConfig = new CloudIotConfig();
    cloudIotConfig.registry_id = registryId;
    cloudIotConfig.cloud_region = proxyConfig.dstCloudRegion;
    return cloudIotConfig;
  }

  private String getPublisherKey(String deviceId) {
    return Joiner.on(":").join(proxyConfig.dstProjectId, registryId, deviceId);
  }

  public MessagePublisher getMqttPublisher(String deviceId) {
    String publisherKey = getPublisherKey(deviceId);
    return messagePublishers
        .computeIfAbsent(publisherKey, deviceKey -> newMqttPublisher(deviceId));
  }

  private MessagePublisher newMqttPublisher(String deviceId) {
    Device device = cloudIotManager.fetchDevice(deviceId);
    Map<String, String> metadata = device.getMetadata();
    String keyAlgorithm = metadata.get("key_algorithm");
    byte[] keyBytes = Base64.getDecoder().decode(metadata.get("key_bytes"));
    return new MqttPublisher(proxyConfig.dstProjectId, proxyConfig.dstCloudRegion,
        registryId, deviceId, keyBytes, keyAlgorithm,
        this::messageHandler, this::errorHandler);
  }

  public void publish(String deviceId, String subFolder, String data) {
    if (proxyConfig == null) {
      return;
    }
    String deviceKey = getDeviceKey(deviceId);
    if (subFolder == null) {
      info("Ignoring message with no subFolder for " + deviceKey);
      return;
    }
    if (!targetDevices.contains(deviceId)) {
      if (ignoredDevices.add(deviceId)) {
        info("Ignoring " + subFolder + " message for " + deviceKey);
      }
      return;
    }
    info("Sending " + subFolder + " message for " + deviceKey);
    MessagePublisher messagePublisher = getMqttPublisher(deviceId);
    String mqttTopic = STATE_SUBFOLDER.equals(subFolder) ? STATE_TOPIC :
        String.format(EVENTS_TOPIC_FORMAT, subFolder);
    messagePublisher.publish(deviceId, mqttTopic, data);
    mirrorMessage(deviceId, data, subFolder);
  }

  private String getDeviceKey(String deviceId) {
    return registryId + ":" + deviceId;
  }

  public void terminate() {
    messagePublishers.values().forEach(MessagePublisher::close);
    messagePublishers.clear();
  }

  private void errorHandler(Throwable error) {
    LOG.error("Publisher error", error);
    terminate();
  }

  private void messageHandler(String topic, String message) {
    info("Received message for " + topic);
    if (topic.endsWith(CONFIG_TOPIC)) {
      String deviceId = topic.substring(DEVICE_TOPIC_PREFIX.length(), topic.length() - CONFIG_TOPIC.length() - 1);
      info(String.format("Updating device config for %s/%s", registryId, deviceId));
      cloudIotManager.setDeviceConfig(deviceId, message);
      mirrorMessage(deviceId, message, CONFIG_TOPIC);
    }
  }

  private void mirrorMessage(String deviceId, String message, String subFolder) {
    MessageBundle bundle = new MessageBundle(message);
    bundle.attributes.put("deviceRegistryId", registryId);
    bundle.attributes.put("deviceId", deviceId);
    bundle.attributes.put("subFolder", subFolder);
    bundleOut.accept(bundle);
  }

  private void info(String msg) {
    LOG.info(msg);
  }
}
