const {clipboard, nativeImage, Menu, MenuItem, shell, dialog} = require('electron');
const url = require('url');
const fs = require('fs');
const request = require('request');

const MAILTO_PREFIX = "mailto:";

const PERMITTED_URL_SCHEMES = [
    'http:',
    'https:',
    MAILTO_PREFIX,
];

function safeOpenURL(target) {
    // openExternal passes the target to open/start/xdg-open,
    // so put fairly stringent limits on what can be opened
    // (for instance, open /bin/sh does indeed open a terminal
    // with a shell, albeit with no arguments)
    const parsedUrl = url.parse(target);
    if (PERMITTED_URL_SCHEMES.indexOf(parsedUrl.protocol) > -1) {
        // explicitly use the URL re-assembled by the url library,
        // so we know the url parser has understood all the parts
        // of the input string
        const newTarget = url.format(parsedUrl);
        shell.openExternal(newTarget);
    }
}

function onWindowOrNavigate(ev, target) {
    // always prevent the default: if something goes wrong,
    // we don't want to end up opening it in the electron
    // app, as we could end up opening any sort of random
    // url in a window that has node scripting access.
    ev.preventDefault();
    safeOpenURL(target);
}

function onLinkContextMenu(ev, params) {
    let url = params.linkURL || params.srcURL;

    if (url.startsWith('vector://vector/webapp')) {
        url = "https://riot.im/app/" + url.substring(23);
    }

    const popupMenu = new Menu();
    // No point trying to open blob: URLs in an external browser: it ain't gonna work.
    if (!url.startsWith('blob:')) {
        popupMenu.append(new MenuItem({
            label: url,
            click() {
                safeOpenURL(url);
            },
        }));
    }

    let addSaveAs = false;
    if (params.mediaType && params.mediaType === 'image' && !url.startsWith('file://')) {
        popupMenu.append(new MenuItem({
            label: '&Copy image',
            click() {
                if (url.startsWith('data:')) {
                    clipboard.writeImage(nativeImage.createFromDataURL(url));
                } else {
                    ev.sender.copyImageAt(params.x, params.y);
                }
            },
        }));

        // We want the link to be ordered below the copy stuff, but don't want to duplicate
        // the `if` statement, so use a flag.
        addSaveAs = true;
    }

    // No point offering to copy a blob: URL either
    if (!url.startsWith('blob:')) {
        // Special-case e-mail URLs to strip the `mailto:` like modern browsers do
        if (url.startsWith(MAILTO_PREFIX)) {
            popupMenu.append(new MenuItem({
                label: 'Copy email &address',
                click() {
                    clipboard.writeText(url.substr(MAILTO_PREFIX.length));
                },
            }));
        } else {
            popupMenu.append(new MenuItem({
                label: 'Copy link &address',
                click() {
                    clipboard.writeText(url);
                },
            }));
        }
    }

    if (addSaveAs) {
        popupMenu.append(new MenuItem({
            label: 'Sa&ve image as...',
            click() {
                const targetFileName = params.titleText || "image.png";
                const filePath = dialog.showSaveDialog({
                    defaultPath: targetFileName,
                });

                if (!filePath) return; // user cancelled dialog

                try {
                    if (url.startsWith("data:")) {
                        fs.writeFileSync(filePath, nativeImage.createFromDataURL(url));
                    } else {
                        request.get(url).pipe(fs.createWriteStream(filePath));
                    }
                } catch (err) {
                    console.error(err);
                    dialog.showMessageBox({
                        type: "error",
                        title: "Failed to save image",
                        message: "The image failed to save",
                    });
                }
            },
        }));
    }

    // popup() requires an options object even for no options
    popupMenu.popup({});
    ev.preventDefault();
}

function _CutCopyPasteSelectContextMenus(params) {
    const options = [];

    if (params.misspelledWord) {
        params.dictionarySuggestions.forEach(word => {
            options.push({
                label: word,
                click: (menuItem, browserWindow) => {
                    browserWindow.webContents.replaceMisspelling(word);
                },
            });
        });
        options.push({
            type: 'separator',
        }, {
            label: 'Add to dictionary',
            click: (menuItem, browserWindow) => {
                browserWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
            },
        }, {
            type: 'separator',
        });
    }

    options.push({
        role: 'cut',
        label: 'Cu&t',
        enabled: params.editFlags.canCut,
    }, {
        role: 'copy',
        label: '&Copy',
        enabled: params.editFlags.canCopy,
    }, {
        role: 'paste',
        label: '&Paste',
        enabled: params.editFlags.canPaste,
    }, {
        role: 'pasteandmatchstyle',
        enabled: params.editFlags.canPaste,
    }, {
        role: 'selectall',
        label: "Select &All",
        enabled: params.editFlags.canSelectAll,
    });
    return options;
}

function onSelectedContextMenu(ev, params) {
    const items = _CutCopyPasteSelectContextMenus(params);
    const popupMenu = Menu.buildFromTemplate(items);

    // popup() requires an options object even for no options
    popupMenu.popup({});
    ev.preventDefault();
}

function onEditableContextMenu(ev, params) {
    const items = [
        { role: 'undo' },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
    ].concat(_CutCopyPasteSelectContextMenus(params));

    const popupMenu = Menu.buildFromTemplate(items);

    // popup() requires an options object even for no options
    popupMenu.popup({});
    ev.preventDefault();
}


module.exports = (webContents) => {
    webContents.on('new-window', onWindowOrNavigate);
    webContents.on('will-navigate', (ev, target) => {
        if (target.startsWith("vector://")) return;
        return onWindowOrNavigate(ev, target);
    });

    webContents.on('context-menu', function(ev, params) {
        if (params.linkURL || params.srcURL) {
            onLinkContextMenu(ev, params);
        } else if (params.selectionText) {
            onSelectedContextMenu(ev, params);
        } else if (params.isEditable) {
            onEditableContextMenu(ev, params);
        }
    });
};
