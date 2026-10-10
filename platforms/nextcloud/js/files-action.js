/* Screenplay — Files app integration
 * Registers an "Open in Screenplay" action for .fountain files.
 * Loaded via LoadAdditionalScriptsEvent (Files app context only).
 */
(function () {
    'use strict';

    function openFile(filename, context) {
        var dir = (context && context.dir) ? context.dir : '/';
        var path = dir.replace(/\/+$/, '') + '/' + filename;
        window.location.href = OC.generateUrl('/apps/screenplay') +
            '?path=' + encodeURIComponent(path);
    }

    function register() {
        if (!window.OCA || !OCA.Files || !OCA.Files.fileActions) return;

        // Primary: files already detected as text/x-fountain (new uploads after
        // the mimetype registration ran).
        OCA.Files.fileActions.register(
            'text/x-fountain',
            'OpenScreenplay',
            OC.PERMISSION_READ,
            OC.imagePath('screenplay', 'app'),
            openFile,
            t('screenplay', 'Open in Screenplay')
        );
        OCA.Files.fileActions.setDefault('text/x-fountain', 'OpenScreenplay');

        // Fallback: files stored before mimetype was registered land as
        // application/octet-stream — check the extension in the handler.
        OCA.Files.fileActions.register(
            'application/octet-stream',
            'OpenScreenplay',
            OC.PERMISSION_READ,
            OC.imagePath('screenplay', 'app'),
            function (filename, context) {
                if (!filename.endsWith('.fountain')) return;
                openFile(filename, context);
            },
            t('screenplay', 'Open in Screenplay')
        );
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', register);
    } else {
        register();
    }
}());
