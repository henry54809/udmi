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
  const subFolder = event.attributes.subFolder || 'unknown';
  const base64 = event.data;
  const msgString = Buffer.from(base64, 'base64').toString();
  const msgObject = JSON.parse(msgString);
  const now = Date.now();
  const timestamp = new Date(now).toJSON();

  console.log('target', registryId, deviceId, subFolder, msgObject);

  const reg_doc = db.collection('registry').doc(registryId);
  const dev_doc = reg_doc.collection('device').doc(deviceId);
  dev_doc.set({
    'updated': timestamp
  }, { merge: true });
  const folder_doc = dev_doc.collection('events').doc(subFolder);
  folder_doc.set({
    'updated': timestamp
  }, { merge: true });
  folder_doc.set(msgObject);

  return null;
});

exports.device_state = functions.pubsub.topic('state').onPublish((event) => {
  const attributes = event.attributes;
  const registryId = attributes.deviceRegistryId;
  const deviceId = attributes.deviceId;
  const base64 = event.data;
  const msgString = Buffer.from(base64, 'base64').toString();
  const msgObject = JSON.parse(msgString);

  console.log('state -> target', registryId, deviceId)

  attributes.subFolder = 'state';
  return publishPubsubMessage('target', msgObject, attributes).then(() => {
    return getDeviceDoc(registryId, deviceId);
  }).then((deviceDoc) => {
    for (var block in msgObject) {
      console.log('Updating state block', block)
      if (typeof msgObject[block] === 'object') {
        state_block = deviceDoc.collection('state').doc(block);
        state_block.set(msgObject[block]);
      }
    }
    return null;
  });
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

  const reg_doc = db.collection('registry').doc(registryId);
  reg_doc.set({
    'updated': timestamp
  }, { merge: true });
  const dev_doc = reg_doc.collection('device').doc(deviceId);
  dev_doc.set({
    'updated': timestamp
  }, { merge: true });
  const config_doc = dev_doc.collection('config').doc(subFolder);

  return config_doc.set(msgObject);
});

function update_device_config(message, attributes) {
  const projectId = attributes.projectId;
  const cloudRegion = attributes.cloudRegion;
  const registryId = attributes.deviceRegistryId;
  const deviceId = attributes.deviceId;
  const version = 0;

  const msgString = JSON.stringify(message);
  const binaryData = Buffer.from(msgString);

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

  return iotClient.modifyCloudToDeviceConfig(request).then(responses => {
    //console.log('Success:', responses[0]);
  }).catch(err => {
    console.error('Could not update config:', deviceId, err);
  });
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
  return configs.get()
    .then((snapshot) => {
      snapshot.forEach(doc => {
        console.log('consolidating config with', registryId, deviceId, doc.id);
        new_config[doc.id] = doc.data();
      })
    })
    .then(() => {
      attributes = {
        projectId: projectId,
        cloudRegion: cloudRegion,
        deviceRegistryId: registryId,
        deviceId: deviceId,
        subFolder: 'config'
      }
      publishPubsubMessage('target', new_config, attributes)
        .then(console.log('target publish complete'));
      update_device_config(new_config, attributes);
    });
}

exports.config_update = functions.firestore
  .document('registry/{registryId}/device/{deviceId}/config/{subFolder}')
  .onWrite((change, context) => {
    console.log('processing config update');
    return consolidateConfig(context.params.registryId, context.params.deviceId);
  });

function publishPubsubMessage(topicName, data, attributes) {
  const dataBuffer = Buffer.from(JSON.stringify(data));

  return pubsub
    .topic(topicName)
    .publish(dataBuffer, attributes)
    .then(messageId => {
      console.debug(`Message ${messageId} published to ${topicName}.`);
    })
    .catch(err => {
      console.error('publishing error:', err);
    });
}
