/**
 * Simple file to handle test results events from DAQ.
 * Uses firebase for data management, and renders straight to HTML.
 */

document.addEventListener('DOMContentLoaded', () => {
  db = firebase.firestore();
  const settings = {
  };
  db.settings(settings);
  if (location.hostname === "localhost") {
    //firebase.auth().useEmulator('http://localhost:9099/');
    db.useEmulator("localhost", 8080);
  }
});

function getQueryParam(field) {
  var reg = new RegExp('[?&]' + field + '=([^&#]*)', 'i');
  var string = reg.exec(window.location.href);
  return string ? string[1] : null;
}

function statusUpdate(message, e) {
  console.log(message);
  if (e) {
    console.error(e);
    message = message + ' ' + String(e)
  }
  document.getElementById('status').innerHTML = message;
}

function listUsers() {
  const link_group = document.querySelector('#listings .users');
  const users_doc = db.collection('users');
  users_doc.get().then((users_docs) => {
    users_docs.forEach((user_doc) => {
      const info_doc = users_doc.doc(user_doc.id).collection('info').doc('profile');
      info_doc.get().then((snapshot) => {
        const userLink = document.createElement('a');
        userLink.innerHTML = snapshot.data().email
        link_group.appendChild(userLink);
        link_group.appendChild(document.createElement('p'));
      });
    });
  }).catch((e) => statusUpdate('user list error', e));
}

function showDevice(registry_id, device_id) {
  statusUpdate(`Show device ${registry_id}:${device_id}`)
  const device_doc = db
        .collection('registry').doc(registry_id)
        .collection('device').doc(device_id);
  element = 'hello';
  showDeviceDocuments(device_doc, 'config', element);
  showDeviceDocuments(device_doc, 'state', element);
  showDeviceDocuments(device_doc, 'events', element);
}

function showDeviceDocuments(device_doc, subsection, target_element) {
  collection = device_doc.collection(subsection);
  collection.onSnapshot((device_docs) => {
    device_docs.forEach((doc) => {
      updateDeviceTable(target_element, subsection, doc.id, doc.data());
    });
  });
}

function updateDeviceTable(element, subsection, subblock, data) {
  // TODO: Write this into a table!
  console.log(element, subsection, subblock, data);
}

function authenticated(userData) {
  if (!userData) {
    statusUpdate('Authentication failed, please sign in.');
    return;
  }

  const user_doc = db.collection('users').doc(userData.uid);
  const perm_doc = user_doc.collection('iam').doc('default');
  const info_doc = user_doc.collection('info').doc('profile');
  const timestamp = new Date().toJSON();
  info_doc.set({
      name: userData.displayName,
      email: userData.email,
      updated: timestamp
  }).then(function() {
    statusUpdate('User info updated');
    perm_doc.get().then((doc) => {
      if (doc.exists && doc.data().enabled) {
        setupUser();
      } else {
        statusUpdate('User not enabled, contact your system administrator.');
      }
    });
  }).catch((e) => statusUpdate('Error updating user info', e));
}

function setupUser() {
  try {
    const registry_id = getQueryParam('registry');
    const device_id = getQueryParam('device');
    statusUpdate('System initialized.');
    if (device_id) {
      showDevice(registry_id, device_id);
    } else {
      listUsers();
    }
  } catch (e) {
    statusUpdate('Loading error', e);
  }
}
