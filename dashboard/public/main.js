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

function linkWithParam(param, value) {
  const href = window.location.href
  const sep = href.indexOf('?') >= 0 ? '&' : '?';
  return `${href}${sep}${param}=${value}`
}

function listCollection(collection, root_doc, param) {
  document.querySelector(`#listings .${collection}`).classList.remove('hidden');
  const link_group = document.querySelector(`#listings .${collection} .listing`);
  const collection_doc = root_doc.collection(param);
  collection_doc.get().then((collection_docs) => {
    collection_docs.forEach((doc) => {
      const collectionLink = document.createElement('a');
      const collection_href = linkWithParam(param, doc.id);
      collectionLink.setAttribute('href', collection_href);
      collectionLink.innerHTML = doc.id
      link_group.appendChild(collectionLink);
      link_group.appendChild(document.createElement('p'));
    });
  }).catch((e) => statusUpdate(`${collection} list error`, e));
}

function listRegistries() {
  statusUpdate('listing registries');
  listCollection('registries', db, 'registry');
}

function listDevices(registry_id) {
  statusUpdate(`listing devices for registry ${registry_id}`);
  const registry_doc = db.collection('registry').doc(registry_id);
  listCollection('devices', registry_doc, 'device');
}

function showDevice(registry_id, device_id) {
  statusUpdate(`Show device ${registry_id}:${device_id}`)
  const device_doc = db
        .collection('registry').doc(registry_id)
        .collection('device').doc(device_id);
  const device_root = document.getElementById('device_display');
  showDeviceDocuments(device_root, device_doc, 'config');
  showDeviceDocuments(device_root, device_doc, 'state');
  showDeviceDocuments(device_root, device_doc, 'events');
}

function showDeviceDocuments(device_root, device_doc, subsection) {
  device_doc.collection(subsection).onSnapshot((device_docs) => {
    device_docs.forEach((doc) => {
      const channel_element = ensureDeviceTable(device_root, doc.id);
      updateDeviceRows(doc.data(), (row_key, cell_data) => {
        const row_element = ensureDeviceRow(channel_element, row_key);
        const column_element = ensureDeviceColumn(row_element, subsection);
        column_element.innerHTML = cell_data;
      });
    });
  });
}

function updateDeviceRows(data, populate) {
  for (topKey in data) {
    const keyData = data[topKey];
    if (typeof keyData === 'object') {
      for (nextKey in keyData) {
        populate(topKey + '/' + nextKey, keyData[nextKey]);
      }
    } else {
      populate(topKey, keyData);
    }
  }
}

function ensureChild(root, selector, type) {
  const existing = root.querySelector(selector);
  const actual = existing || document.createElement(type);
  existing || root.appendChild(actual);
  return actual;
}

function ensureDeviceTable(device_root, table_name) {
  const table = ensureChild(device_root, 'table', 'table');
  return ensureChild(table, 'tbody', 'tbody');
}

function ensureDeviceRow(device_table, row_name) {
  const row = ensureChild(device_table, 'tr', 'tr');
  return row;
}

function ensureDeviceColumn(device_row, column_name) {
  const cell = ensureChild(device_row, 'td', 'td');
  return cell;
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
    if (!registry_id) {
      listRegistries();
    } else if (!device_id) {
      listDevices(registry_id);
    } else {
      showDevice(registry_id, device_id);
    }
  } catch (e) {
    statusUpdate('Loading error', e);
  }
}
