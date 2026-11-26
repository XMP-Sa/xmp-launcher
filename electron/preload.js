'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('xmp', {
  window: {
    minimize: () => invoke('win:action', 'minimize'),
    maximize: () => invoke('win:action', 'maximize'),
    close: () => invoke('win:action', 'close'),
    quit: () => invoke('win:action', 'quit'),
  },
  app: {
    info: () => invoke('app:info'),
    open: (url) => invoke('shell:open', url),
    log: (name, data) => invoke('log:event', name, data),
  },
  prefs: {
    get: () => invoke('prefs:get'),
    set: (patch) => invoke('prefs:set', patch),
  },
  servers: {
    fetch: () => invoke('servers:fetch'),
    ping: (list) => invoke('servers:ping', list),
    pingOne: (server) => invoke('servers:pingOne', server),
  },
  game: {
    detect: () => invoke('game:detect'),
    browse: () => invoke('game:browse'),
    detectGta: () => invoke('game:detectGta'),
    browseGta: () => invoke('game:browseGta'),
    launch: (payload) => invoke('game:launch', payload),
    openFolder: () => invoke('game:openFolder'),
  },
  client: {
    status: () => invoke('client:status'),
    check: () => invoke('client:check'),
    install: () => invoke('client:install'),
    remove: () => invoke('client:remove'),
    onProgress: (cb) => ipcRenderer.on('client:progress', (e, data) => cb(data)),
  },
  update: {
    check: () => invoke('update:check'),
  },
});
