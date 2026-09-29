/* ============================================================================
   Attachments (images/photos) subsystem
   ----------------------------------------------------------------------------
   Stores attachments as files on disk when running natively (Capacitor),
   falling back to data URLs in web mode. The DB holds only metadata.

   Collections:
   - attachments: { id, entity, entityId, name, mime, bytes, path, dataUrl,
                    width, height, thumbPath, thumbDataUrl, createdAt, createdBy }
   ========================================================================= */

const Attachments = (function () {
  const ensure = () => { if (!DB.get('attachments')) DB.set('attachments', []); };

  function uidAtt() { return 'ATT-' + Math.random().toString(36).slice(2, 8).toUpperCase() + '-' + Date.now().toString(36).toUpperCase(); }

  async function fileToDataUrl(file) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  }

  async function blobFromDataUrl(dataUrl) {
    const [h, b64] = dataUrl.split(','); const mime = h.match(/:(.*?);/)?.[1] || 'image/jpeg'; const bin = atob(b64); const n = bin.length; const u8 = new Uint8Array(n); for (let i=0;i<n;i++) u8[i]=bin.charCodeAt(i); return new Blob([u8], { type: mime });
  }

  /**
   * Downscale for the grid. Returns the original when the source is already
   * small — re-encoding a 64px PNG as JPEG produced a *larger* thumbnail
   * (1071 chars from a 398-char source), which is the opposite of the point.
   */
  async function resizeDataUrl(dataUrl, maxW=320, maxH=320, q=0.72) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        /* Only downscale. A thumbnail that is bigger than the original wastes
         * storage on every attachment. */
        if (img.width <= maxW && img.height <= maxH) return res(dataUrl);
        const r = Math.min(maxW / img.width, maxH / img.height);
        const w = Math.max(1, Math.round(img.width * r));
        const h = Math.max(1, Math.round(img.height * r));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        try {
          const out = c.toDataURL('image/jpeg', q);
          res(out.length < dataUrl.length ? out : dataUrl);
        } catch (e) { res(dataUrl); }
      };
      img.onerror = () => res(dataUrl);
      img.src = dataUrl;
    });
  }

  async function addFromDataUrl({ entity, entityId, dataUrl, name='photo.jpg', mime='image/jpeg' }) {
    ensure();
    const att = { id: uidAtt(), entity, entityId, name, mime, bytes: 0, createdAt: nowISO(), createdBy: (state.session?.user?.name)||'System' };
    const blob = await blobFromDataUrl(dataUrl);
    att.bytes = blob.size;
    const thumb = await resizeDataUrl(dataUrl);

    const P = (typeof window !== 'undefined' && window.SFPlugins) || null;
    if (Native.isNative() && P && P.Filesystem) {
      try {
        const { Filesystem, Directory } = P;
        const p = `attachments/${att.id}.jpg`;
        const tp = `attachments/${att.id}_thumb.jpg`;
        await Filesystem.writeFile({ path: p, data: dataUrl.split(',')[1], directory: Directory.Documents });
        await Filesystem.writeFile({ path: tp, data: thumb.split(',')[1], directory: Directory.Documents });
        /* Only the paths are stored. Base64 in the JSON blob is what would
         * exhaust the localStorage quota on a handful of photos. */
        att.path = p; att.thumbPath = tp;
      } catch (e) {
        console.warn('attachment write failed, keeping inline', e);
        att.dataUrl = dataUrl; att.thumbDataUrl = thumb;
      }
    } else {
      att.dataUrl = dataUrl; att.thumbDataUrl = thumb;
    }
    DB.insert('attachments', att); DB.save(); return att;
  }

  return {
    ensure,
    list(entity, entityId){ ensure(); return DB.get('attachments').filter(a=>a.entity===entity&&a.entityId===entityId).sort((x,y)=>y.createdAt.localeCompare(x.createdAt)); },
    async capture(entity, entityId){ const r = await Native.capturePhoto(); if (!r.ok) return null; const du = r.dataUrl || (r.base64 ? `data:image/${r.format||'jpeg'};base64,${r.base64}` : null); if (!du) return null; return addFromDataUrl({ entity, entityId, dataUrl: du }); },
    async pick(entity, entityId, multiple=false){ const r = await Native.pickImages(multiple); if (!r.ok||!r.items?.length) return []; const out=[]; for (const it of r.items){ const du = it.dataUrl || (it.base64 ? `data:image/${it.format||'jpeg'};base64,${it.base64}` : null); if (du) out.push(await addFromDataUrl({ entity, entityId, dataUrl: du })); } return out; },
    /* Deletes the DB row and, on native, the image and thumbnail files too —
     * otherwise removing a photo leaks a file for every capture. */
    async remove(id){
      const att = DB.get('attachments').find(a => a.id === id);
      DB.remove('attachments', id);
      DB.save();
      if (!att) return;
      const P = (typeof window !== 'undefined' && window.SFPlugins) || null;
      if (Native.isNative() && P && P.Filesystem && (att.path || att.thumbPath)) {
        for (const p of [att.path, att.thumbPath]) {
          if (!p) continue;
          try { await P.Filesystem.deleteFile({ path: p, directory: P.Directory.Documents }); }
          catch (e) { /* already gone, or never written */ }
        }
      }
    },

    /* Directory.Documents is the app-specific external directory, not
     * /storage/emulated/0/Documents, so the path has to be converted before a
     * WebView will load it. convertFileSrc does that; without it we fall back
     * to inline data. */
    _src(p){
      if (!p) return '';
      const cap = typeof window !== 'undefined' ? window.Capacitor : null;
      if (cap && cap.convertFileSrc) {
        try { return cap.convertFileSrc({ path: p, webDir: 'Documents' }); } catch (e) { /* fall through */ }
      }
      return '';
    },
    getUrl(a){
      if (!a) return '';
      if (a.thumbDataUrl) return a.thumbDataUrl;
      if (a.dataUrl) return a.dataUrl;
      return Attachments._src(a.thumbPath || a.path);
    },
    getFullUrl(a){
      if (!a) return '';
      if (a.dataUrl) return a.dataUrl;
      return Attachments._src(a.path) || Attachments.getUrl(a);
    },

    /* Grid of thumbnails with capture/pick/delete, used by the record drawer. */
    panelHtml(entity, entityId){
      const list = Attachments.list(entity, entityId);
      if (!list.length) {
        return `<div class="att-empty">No photos yet</div>`;
      }
      return `<div class="att-grid">${list.map(a => {
        const src = Attachments.getUrl(a);
        return `<figure class="att-cell" data-att="${esc(a.id)}">
          ${src ? `<img src="${esc(src)}" alt="${esc(a.name)}" loading="lazy">`
                : `<div class="att-nofile">${esc(a.name)}</div>`}
          <figcaption>${esc(fmt(a.bytes))} B</figcaption>
          <button class="att-del" data-att-del="${esc(a.id)}" title="Remove photo">✕</button>
        </figure>`;
      }).join('')}</div>`;
    },

    /**
     * Mount a complete photo section into a record drawer: the grid, a camera
     * button and a gallery button, with capture/pick/delete wired up.
     *
     * Every record type that supports photos uses this, so the behaviour is
     * identical everywhere rather than re-implemented per drawer.
     */
    mount(hostSel, entity, entityId, opts) {
      const host = typeof hostSel === 'string' ? qs(hostSel) : hostSel;
      if (!host) return;
      const o = opts || {};

      /* The capture buttons live in the drawer *footer*, which is a sibling of
       * the body that holds #attHost — so scoping to host.parentElement finds
       * nothing and the buttons are silently dead. Scope to the whole dialog. */
      const scope = o.scope
        || host.closest('.drawer, .modal')
        || host.parentElement
        || host;
      const refresh = () => {
        host.innerHTML = Attachments.panelHtml(entity, entityId);
        Attachments.wirePanel(entity, entityId, host, null);
      };

      host.innerHTML = Attachments.panelHtml(entity, entityId);
      Attachments.wirePanel(entity, entityId, host, null);

      const grab = async (picker) => {
        const added = picker ? await Attachments.pick(entity, entityId, true)
                              : [await Attachments.capture(entity, entityId)].filter(Boolean);
        refresh();
        if (added && added.length) {
          toast(added.length > 1 ? `${added.length} photos added` : 'Photo added', 'good');
        } else {
          toast('No photo added', 'warn');
        }
      };

      const shot = o.camera === false ? null : qs('[data-att-cam]', scope);
      const lib  = o.gallery === false ? null : qs('[data-att-lib]', scope);
      if (!shot && !lib) {
        /* mount() without the paired buttons() is a wiring mistake; say so
         * rather than leaving a photo panel that cannot add anything. */
        console.warn('Attachments.mount: no capture buttons found for', entity);
        return;
      }
      if (shot) shot.onclick = async () => {
        shot.disabled = true;
        try { await grab(false); } catch (e) { console.error(e); toast('Could not add photo', 'bad'); }
        finally { shot.disabled = false; }
      };
      if (lib) lib.onclick = async () => {
        lib.disabled = true;
        try { await grab(true); } catch (e) { console.error(e); toast('Could not add photo', 'bad'); }
        finally { lib.disabled = false; }
      };
    },

    /** The two buttons that sit in a drawer footer above an #attHost panel. */
    buttons(canWrite) {
      if (!canWrite) return '';
      return `<button class="btn left" data-att-cam>📷 Photo</button>
              <button class="btn left" data-att-lib>🖼 Gallery</button>`;
    },

    /* Wire capture/pick/delete for a mounted container. */
    wirePanel(entity, entityId, root, onChange){
      if (!root) return;
      $$('[data-att-del]', root).forEach(b => b.onclick = async e => {
        e.stopPropagation();
        const id = b.dataset.attDel;
        const att = DB.get('attachments').find(a => a.id === id);
        /* confirmDialog, not window.confirm: a raw dialog blocks the WebView,
         * looks nothing like the rest of the app, and ignores the back button
         * handler. */
        const ok = await confirmDialog({
          title: 'Remove this photo?',
          message: att ? (att.name || 'Photo') + ' will be detached from this record.' : 'The photo will be removed.',
          confirmLabel: 'Remove', danger: true
        });
        if (!ok) return;
        await Attachments.remove(id);
        root.innerHTML = Attachments.panelHtml(entity, entityId);
        Attachments.wirePanel(entity, entityId, root, onChange);
        if (onChange) onChange();
      });
    }
  };
})();
