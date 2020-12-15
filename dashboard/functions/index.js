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
  reg_doc.set({
    'updated': timestamp
  }, { merge: true });
  const dev_doc = reg_doc.collection('device').doc(deviceId);
  dev_doc.set({
    'updated': timestamp
  }, { merge: true });
  const folder_doc = dev_doc.collection('events').doc(subFolder);
  folder_doc.set({
    'updated': timestamp
  }, { merge: true });
  const entry_doc = folder_doc.collection('entry').doc(timestamp);
  entry_doc.set(msgObject);

  return null;
});

exports.device_state = functions.pubsub.topic('state').onPublish((event) => {
  const attributes = event.attributes;
  const registryId = attributes.deviceRegistryId;
  const deviceId = attributes.deviceId;
  const base64 = event.data;
  const msgString = Buffer.from(base64, 'base64').toString();
  const msgObject = JSON.parse(msgString);

  attributes.subFolder = 'state';
  console.log(`Processing state update for ${deviceId}`, msgObject);
  return publishPubsubMessage('target', msgObject, attributes).then(() => {
    return getDeviceDoc(registryId, deviceId);
  }).then((deviceDoc) => {
    deviceState = deviceDoc.collection('state').doc('latest');
    return deviceState.set(msgObject);
  });
});

exports.device_config = functions.pubsub.topic('config').onPublish((event) => {
  const attributes = event.attributes;
  const subFolder = attributes.subFolder;
  if (subFolder != 'config') {
    return null;
  }
  const projectId = attributes.projectId;
  const cloudRegion = attributes.cloudRegion;
  const registryId = attributes.deviceRegistryId;
  const deviceId = attributes.deviceId;
  const binaryData = event.data;
  const msgString = Buffer.from(binaryData, 'base64').toString();
  const msgObject = JSON.parse(msgString);
  const version = 0;

  console.log(projectId, cloudRegion, registryId, deviceId, msgString);

  const formattedName = iotClient.devicePath(
    projectId,
    cloudRegion,
    registryId,
    deviceId
  );

  console.log(formattedName, msgObject);

  const request = {
    name: formattedName,
    versionToUpdate: version,
    binaryData: binaryData,
  };

  return iotClient.modifyCloudToDeviceConfig(request).then(responses => {
    console.log('Success:', responses[0]);
  }).catch(err => {
    console.error('Could not update config:', deviceId, err);
  });
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
