/* ============================================================================
   Native bridge (Capacitor-aware) with web fallbacks
   ----------------------------------------------------------------------------
   Feature-detects Capacitor and provides minimal, defensive wrappers for:
   - Back button handling (Android)
   - File save/open (export/import)
   - Camera capture + gallery pick
   - Filesystem helpers
   ========================================================================= */

const Native = (function () {
  const isCapacitor = () => typeof window !== 'undefined' && window.Capacitor && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : false);
  const platform = () => (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.getPlatform) ? window.Capacitor.getPlatform() : 'web';

  /* Capacitor plugins are bundled by esbuild (mobile/native-entry.js) onto
   * window.SFPlugins. A dynamic import() cannot work in this file: the app is
   * one hand-concatenated IIFE with no module loader, so a bare specifier such
   * as '@capacitor/app' always throws and silently degrades to the web path. */
  const plugins = () => (typeof window !== 'undefined' && window.SFPlugins) || null;

  const backListeners = [];
  let backInstalled = false;

  function notifyBack() {
    /* Call listeners newest-first until one returns true, meaning the press was
     * consumed and the app must stay open. */
    for (let i = backListeners.length - 1; i >= 0; i--) {
      try {
        if (backListeners[i]()) return true;
      } catch (e) { console.warn('back handler failed', e); }
    }
    return false;
  }

  function installBack() {
    if (backInstalled) return;
    backInstalled = true;

    if (isCapacitor()) {
      const P = plugins();
      if (P && P.App) {
        P.App.addListener('backButton', () => {
          /* If nothing consumed the press, background the app rather than
           * killing it. Exiting from any screen is what made the hardware back
           * button feel like "close the app". */
          if (notifyBack()) return;
          if (P.App.minimizeApp) { P.App.minimizeApp(); return; }
          P.App.exitApp();
        });
        return;
      }
      console.warn('Capacitor App plugin missing — back button falls back to the web path');
    }

    /* Web: there is no hardware back button, and Escape is wired up directly by
     * BackNav.install(). Registering it here too would run the handler twice
     * per keypress. */
  }

  return {
    isNative: isCapacitor,
    platform,
    onBack(fn) {
      if (typeof fn !== 'function') return () => {};
      backListeners.push(fn);
      installBack();
      return () => {
        const i = backListeners.indexOf(fn);
        if (i >= 0) backListeners.splice(i, 1);
      };
    },
    /* Text export. Native writes to Documents/ then offers the share sheet,
     * which is the only reliable path on Android 10+ — an <a download> in a
     * WebView is frequently ignored under scoped storage. */
    async saveFile(filename, content, mimeType = 'text/plain') {
      if (isCapacitor()) {
        const P = plugins();
        if (P && P.Filesystem && P.Share) {
          try {
            const { Filesystem, Directory } = P;
            const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
            /* Encode to base64 by hand: the Filesystem plugin expects base64 and
             * btoa alone breaks on any non-Latin1 character. */
            const bytes = new TextEncoder().encode(data);
            let bin = '';
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            const path = `AMAYA/${filename}`;
            await Filesystem.writeFile({ path, data: btoa(bin), directory: Directory.Documents });
            try { await P.Share.share({ title: filename, url: path, dialogTitle: filename }); }
            catch (_) { /* user dismissed, or no share target — file is still saved */ }
            return { ok: true, method: 'capacitor', path };
          } catch (e) {
            console.warn('Capacitor saveFile failed, falling back to web', e);
          }
        }
      }
      // Web fallback: Blob download
      try {
        const blob = new Blob([typeof content === 'string' ? content : JSON.stringify(content, null, 2)], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
        return { ok: true, method: 'web' };
      } catch (e) { console.error(e); return { ok: false, error: e }; }
    },
    /* Native reads via the Filesystem read plus a document picker; if the
     * picker plugin is unavailable the <input type=file> path is used, which
     * still works in an Android WebView. */
    async pickFile(accept = 'text/*') {
      if (isCapacitor()) {
        const P = plugins();
        if (P && P.Filesystem) {
          try {
            /* No picker plugin installed: fall through to the input fallback
             * rather than pretending we can open the Storage Access Framework. */
          } catch (e) { console.warn(e); }
        }
      }
      return new Promise(resolve => {
        const inp = document.createElement('input');
        inp.type = 'file'; if (accept) inp.accept = accept;
        inp.style.display = 'none'; document.body.appendChild(inp);
        inp.onchange = () => {
          const f = inp.files && inp.files[0];
          if (!f) { document.body.removeChild(inp); return resolve({ ok: false }); }
          const fr = new FileReader();
          fr.onload = () => { document.body.removeChild(inp); resolve({ ok: true, name: f.name, mimeType: f.type, data: fr.result }); };
          fr.onerror = () => { document.body.removeChild(inp); resolve({ ok: false }); };
          fr.readAsText(f);
        };
        inp.click();
      });
    },
    async capturePhoto() {
      if (isCapacitor()) {
        const P = plugins();
        if (P && P.Camera) {
          try {
            /* Ask the user rather than firing the camera immediately — on a
             * permission denial the promise rejects and we would otherwise
             * silently fall through to a file input. */
            const perm = await P.Camera.checkPermissions();
            let state = perm.camera;
            if (state !== 'granted') {
              const req = await P.Camera.requestPermissions({ permissions: ['camera'] });
              state = req.camera;
            }
            if (state === 'granted') {
              const img = await P.Camera.getPhoto({
                resultType: P.CameraResultType.Base64,
                source: P.CameraSource.Camera,
                quality: 85
              });
              return { ok: true, base64: img.base64String, format: img.format, path: img.path };
            }
            return { ok: false, reason: 'camera-permission-denied' };
          } catch (e) { console.warn('Camera capture failed, falling back', e); }
        }
      }
      return new Promise(resolve => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment'; inp.style.display = 'none'; document.body.appendChild(inp);
        inp.onchange = () => {
          const f = inp.files && inp.files[0]; if (!f) { document.body.removeChild(inp); return resolve({ ok: false }); }
          const fr = new FileReader();
          fr.onload = () => { document.body.removeChild(inp); resolve({ ok: true, dataUrl: fr.result, name: f.name, mimeType: f.type }); };
          fr.onerror = () => { document.body.removeChild(inp); resolve({ ok: false }); };
          fr.readAsDataURL(f);
        };
        inp.click();
      });
    },
    async pickImages(multiple = false) {
      if (isCapacitor()) {
        const P = plugins();
        if (P && P.Camera) {
          try {
            /* Photos come from the gallery, so only the read-media permission
             * can be required. A denial is reported, never silently retried. */
            const perm = await P.Camera.checkPermissions();
            let state = perm.photos;
            if (state !== 'granted') {
              const req = await P.Camera.requestPermissions({ permissions: ['photos'] });
              state = req.photos;
            }
            if (state === 'granted') {
              const photos = await P.Camera.pickImages({
                quality: 85,
                limit: multiple ? 20 : 1
              });
              const items = (photos.photos || []).map(p => ({
                base64: p.base64String, path: p.path, format: p.format
              }));
              return { ok: true, items };
            }
            return { ok: false, items: [], reason: 'photos-permission-denied' };
          } catch (e) { console.warn('pickImages failed, falling back', e); }
        }
      }
      return new Promise(resolve => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; if (multiple) inp.multiple = true; inp.style.display = 'none'; document.body.appendChild(inp);
        inp.onchange = () => {
          const files = Array.from(inp.files || []);
          if (!files.length) { document.body.removeChild(inp); return resolve({ ok: false, items: [] }); }
          const items = []; let left = files.length;
          files.forEach(f => {
            const fr = new FileReader();
            fr.onload = () => { items.push({ dataUrl: fr.result, name: f.name, mimeType: f.type }); if (--left === 0) { document.body.removeChild(inp); resolve({ ok: true, items }); } };
            fr.onerror = () => { if (--left === 0) { document.body.removeChild(inp); resolve({ ok: true, items }); } };
            fr.readAsDataURL(f);
          });
        };
        inp.click();
      });
    }
  };
})();
