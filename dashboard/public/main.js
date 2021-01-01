/**
 * Simple file to handle UDMI messages.
 * Uses firebase for data management, and renders straight to HTML.
 */

document.addEventListener('DOMContentLoaded', () => {
  db = firebase.firestore();
  const settings = {
  };
  db.settings(settings);
  if (location.hostname === "localhost") {
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
  const collection_doc = root_doc.collection(collection);
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
  const registry_doc = db.collection('registries').doc(registry_id);
  listCollection('devices', registry_doc, 'device');
}

function showDevice(registry_id, device_id) {
  statusUpdate(`Show device ${registry_id}:${device_id}`)
  const device_doc = db
        .collection('registries').doc(registry_id)
        .collection('devices').doc(device_id);
  const device_root = document.getElementById('device');
  device_root.classList.remove('hidden');
  showDeviceDocuments(device_root, device_doc, 'config');
  showDeviceDocuments(device_root, device_doc, 'state');
  showDeviceDocuments(device_root, device_doc, 'events');
}

function showDeviceDocuments(device_root, device_doc, subsection) {
  device_doc.collection(subsection).onSnapshot((device_docs) => {
    device_docs.forEach((doc) => {
      const channel_element = ensureTable(device_root, doc.id);
      updateDeviceRows(doc.data(), (row_key, cell_data) => {
        const cell = setTableValue(channel_element, row_key, subsection, cell_data);
        if (subsection == 'config') {
          const vcell = cell.querySelector('.propvalue');
          vcell.setAttribute('contenteditable', 'true');
          vcell.classList.add('editable');
        }
      });
    });
  });
}

function updateDeviceRows(data, populate) {
  for (topKey in data) {
    const keyData = data[topKey];
    if (typeof keyData === 'object') {
      for (nextKey in keyData) {
        populate(topKey + '/' + nextKey, makeCellHtml(keyData[nextKey]));
      }
    } else {
      populate(topKey, makeCellHtml(keyData));
    }
  }
}

function makeCellHtml(cell_data) {
  let text = '';
  if (typeof cell_data !== 'object') {
    text = cell_data;
  } else for (key in cell_data) {
    text += detailsHtml(key, cell_data[key]);
  }
  return `<div class="output">${text}</div>`;
}

function detailsHtml(key, data) {
  if (typeof data !== 'object') {
    return `${key}: <div class='propvalue'>${data}</div>\n`;
  }
  const details = JSON.stringify(data, null, 2);
  return `<details><summary>${key}</summary>${details}</details>`
}

function ensureTable(device_root, table_name) {
  const table = ensureChild(device_root, table_name, 'table', 'table');
  const tbody = ensureChild(table, table_name, 'tbody', 'tbody');
  setTableValue(tbody, 'hrow', 'hcol', table_name);
  return tbody;
}

function setTableValue(table, row, col, value) {
  const hrow = ensureTableRow(table, 'hrow');
  const hcol = ensureChild(hrow, col, 'td', 'td');
  hcol.innerHTML = col;
  const rowe = ensureTableRow(table, row);
  const cols = hrow.querySelectorAll('td');
  for (let index in Object.keys(cols)) {
    const coln = cols[index].getAttribute('name');
    ensureChild(rowe, coln, 'td', 'td');
  }
  const rowh = ensureChild(rowe, 'hcol', 'td', 'td');
  rowh.innerHTML = row;
  const cole = ensureChild(rowe, col, 'td', 'td');
  cole.innerHTML = value;
  const rows = table.querySelectorAll('tr');
  for (let index in Object.keys(rows)) {
    ensureChild(rows[index], col, 'td', 'td');
  }
  return cole;
}

function ensureTableRow(table, row) {
  return ensureChild(table, row, 'tr', 'tr');
}

function ensureChild(root, name, selector, type) {
  const named_selector = `${selector}[name="${name}"]`
  const existing = root.querySelector(named_selector);
  const actual = existing || document.createElement(type);
  existing || actual.setAttribute('name', name);
  existing || root.appendChild(actual);
  return actual;
}

function authenticated(userData) {
  if (!userData) {
    statusUpdate('Authentication failed, please sign in.');
    return;
  }

  console.log(`Checking authentiation for user ${userData.uid}`);
  const user_doc = db.collection('users').doc(userData.uid);
  const info_doc = user_doc.collection('info').doc('profile');
  const timestamp = new Date().toJSON();
  user_doc.set({
  }).then(function() {
    return info_doc.set({
      name: userData.displayName,
      email: userData.email,
      updated: timestamp
    });
  }).then(() => {
    statusUpdate('User info updated');
    const perm_doc = user_doc.collection('iam').doc('default');
    return perm_doc.get();
  }).then((doc) => {
    if (doc.exists && doc.data().enabled) {
      setupUser();
    } else {
      statusUpdate('User not enabled, contact your system administrator.');
    }
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
