/**
 * Simple function to ingest test results event from DAQ.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { PubSub } = require(`@google-cloud/pubsub`);
const iot = require('@google-cloud/iot');
const pubsub = new PubSub();

admin.initializeApp(functions.config().firebase);
const db = admin.firestore();

const iotClient = new iot.v1.DeviceManagerClient({
  // optional auth parameters.
});

function getDeviceDoc(registryId, deviceId) {
  const reg = db.collection('registry').doc(registryId);
  const dev = reg.collection('device').doc(deviceId);
  return dev;
}

exports.device_target = functions.pubsub.topic('target').onPublish((event) => {
  const registryId = event.attributes.deviceRegistryId;
  const deviceId = event.attributes.deviceId;
  const subType = event.attributes.subType || 'events';
  const subFolder = event.attributes.subFolder || 'unknown';
  const base64 = event.data;
  const msgString = Buffer.from(base64, 'base64').toString();
  const msgObject = JSON.parse(msgString);
  const now = Date.now();
  const timestamp = new Date(now).toJSON();

  console.log('target', registryId, deviceId, subType, subFolder, msgObject);

  if (subType != 'events') {
    return null;
  }

  const reg_doc = db.collection('registry').doc(registryId);
  const dev_doc = reg_doc.collection('device').doc(deviceId);
  dev_doc.set({
    'updated': timestamp
  }, { merge: true });
  const folder_doc = dev_doc.collection('events').doc(subFolder);
  folder_doc.set({
    'updated': timestamp
  }, { merge: true });
  return folder_doc.set(msgObject);
});

exports.device_state = functions.pubsub.topic('state').onPublish((event) => {
  const attributes = event.attributes;
  const registryId = attributes.deviceRegistryId;
  const deviceId = attributes.deviceId;
  const base64 = event.data;
  const msgString = Buffer.from(base64, 'base64').toString();
  const msgObject = JSON.parse(msgString);

  promises = [];

  attributes.subType = 'state';
  for (var block in msgObject) {
    let subMsg = msgObject[block];
    if (typeof subMsg === 'object') {
      console.log('state -> target', registryId, deviceId, block);
      attributes.subFolder = block;
      promises.concat(publishPubsubMessage('target', subMsg, attributes));
      device_doc = getDeviceDoc(registryId, deviceId);
      state_block = device_doc.collection('state').doc(block);
      promises.concat(state_block.set(subMsg));
    }
  }

  return Promise.all(promises);
});

exports.device_config = functions.pubsub.topic('config').onPublish((event) => {
  const attributes = event.attributes;
  const registryId = attributes.deviceRegistryId;
  const deviceId = attributes.deviceId;
  const subFolder = attributes.subFolder || 'unknown';
  const base64 = event.data;
  const now = Date.now();
  const timestamp = new Date(now).toJSON();
  const msgString = Buffer.from(base64, 'base64').toString();
  const msgObject = JSON.parse(msgString);

  console.log('config', registryId, deviceId, subFolder, msgObject);

  promises = [];

  const reg_doc = db.collection('registry').doc(registryId);
  promises.concat(reg_doc.set({
    'updated': timestamp
  }, { merge: true }));
  const dev_doc = reg_doc.collection('device').doc(deviceId);
  promises.concat(dev_doc.set({
    'updated': timestamp
  }, { merge: true }));
  const config_doc = dev_doc.collection('config').doc(subFolder);
  promises.concat(config_doc.set(msgObject));

  attributes.subType = 'config';
  promises.concat(publishPubsubMessage('target', msgObject, attributes));

  return Promise.all(promises);
});

function update_device_config(message, attributes) {
  const projectId = attributes.projectId;
  const cloudRegion = attributes.cloudRegion;
  const registryId = attributes.deviceRegistryId;
  const deviceId = attributes.deviceId;
  const version = 0;

  const msgString = JSON.stringify(message);
  const binaryData = Buffer.from(msgString);

  console.log('format', projectId, cloudRegion, registryId, deviceId);
  const formattedName = iotClient.devicePath(
    projectId,
    cloudRegion,
    registryId,
    deviceId
  );

  console.log('request', formattedName, msgString);

  const request = {
    name: formattedName,
    versionToUpdate: version,
    binaryData: binaryData
  };

  return iotClient.modifyCloudToDeviceConfig(request);
}

function consolidateConfig(registryId, deviceId) {
  const projectId = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT;
  const cloudRegion = 'us-central1';
  const reg_doc = db.collection('registry').doc(registryId);
  const dev_doc = reg_doc.collection('device').doc(deviceId);
  const configs = dev_doc.collection('config');
  const now = Date.now();
  const timestamp = new Date(now).toJSON();

  console.log('consolidating config for', registryId, deviceId);

  const new_config = {
    'version': '1',
    'timestamp': timestamp
  };

  const attributes = {
    projectId: projectId,
    cloudRegion: cloudRegion,
    deviceId: deviceId,
    deviceRegistryId: registryId,
    subType: 'config'
  };

  return configs.get()
    .then((snapshot) => {
      snapshot.forEach(doc => {
        console.log('consolidating config with', registryId, deviceId, doc.id, doc.data());
        new_config[doc.id] = doc.data();
      });
      return update_device_config(new_config, attributes);
    });
}

exports.config_update = functions.firestore
  .document('registry/{registryId}/device/{deviceId}/config/{subFolder}')
  .onWrite((change, context) => {
    return consolidateConfig(context.params.registryId, context.params.deviceId);
  });

function publishPubsubMessage(topicName, data, attributes) {
  const dataBuffer = Buffer.from(JSON.stringify(data));
  var attr_copy = Object.assign({}, attributes);

  console.log('publish', topicName, attributes, data);

  return pubsub
    .topic(topicName)
    .publish(dataBuffer, attr_copy)
    .then(messageId => {
      console.debug(`Message ${messageId} published to ${topicName}.`);
    });
}
