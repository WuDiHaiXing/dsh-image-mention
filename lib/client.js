/**
 * dsh-image-mention — browser half.
 *
 * Registers one '@' input-trigger source that lists the pictures currently sitting in the
 * composer draft and inserts a reference token whose model serialization anchors 1:1 onto
 * the platform's own per-image handle text ("Image \"<name>\" (sha256:…); request preview …").
 *
 * Zero runtime dependencies beyond react (served by the client module table).
 * Loaded by the DSH client ModuleLoader: `id` must equal the package name.
 *
 * Contract faces used (all published by the 0.1.7-rc.2 client packages):
 *   - ctx.get('inputTriggers').registerSource(source)            (dsh-client-ui-input-trigger)
 *   - ctx.effect(() => dispose, label)                           (cordis)
 *   - ctx.get('sessions').scope(sessionId)                       (dsh-api-session-controller/client)
 *   - ctx.get('conversation').input.for(actx).state              (dsh-client-ui-conversation/client)
 * Non-contract faces (guarded, optional; only enrich the rows, never gate the feature):
 *   - conversation.resolveDraftAttachments(ids) -> ComposerAttachment[]  (ConversationController method,
 *     absent from the IConversation type face; returns a SHORTER array when an id no longer resolves)
 */
window.__ModuleLoader__.load({
  id: 'dsh-image-mention',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');

    const SOURCE_NAME = 'image';
    const REF_PREFIX = 'img:';
    const THUMB_SIZE = 22;
    const MAX_ICONS = 64;
    const MAX_NAME = 255;

    /** sessionId -> { ids, images:[{id,ordinal,name}] } — the last NON-EMPTY draft snapshot. */
    const draftCache = new Map();
    /** previewUrl -> memoized thumbnail component (stable identity keeps React from remounting it). */
    const iconCache = new Map();
    const warned = new Set();

    function warnOnce(key, detail) {
      if (warned.has(key)) return;
      warned.add(key);
      if (detail === undefined) console.warn('[dsh-image-mention] ' + key);
      else console.warn('[dsh-image-mention] ' + key, detail);
    }

    /** ctx.get never throws for a missing optional service, but a hostile context must not kill the source. */
    function safeGet(ctx, name) {
      try {
        return ctx.get(name);
      } catch (error) {
        warnOnce('service unavailable: ' + name, error);
        return undefined;
      }
    }

    // ---------------------------------------------------------------- helpers

    /** Mirror of the host's displayName(): last path segment, no control chars, trimmed, <= 255. */
    function normalizeName(value) {
      if (typeof value !== 'string') return undefined;
      const cut = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
      let name = cut === -1 ? value : value.slice(cut + 1);
      name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (name.length > MAX_NAME) name = name.slice(0, MAX_NAME);
      return name === '' ? undefined : name;
    }

    function positiveInt(value) {
      return typeof value === 'number' && isFinite(value) && value > 0 ? Math.round(value) : undefined;
    }

    // ------------------------------------------------- 1. contract read path

    /**
     * Ordered, opaque draft attachment ids. Everything here is published contract;
     * a non-retained session scope returns undefined instead of throwing through the menu.
     */
    function readDraftIds(ctx, sessionId) {
      const sessions = safeGet(ctx, 'sessions');
      if (sessions === undefined || sessions === null || typeof sessions.scope !== 'function') return undefined;
      const actx = sessions.scope(sessionId);
      if (actx === undefined || actx === null) return undefined;
      const conversation = safeGet(ctx, 'conversation');
      const resolver = conversation === undefined || conversation === null ? undefined : conversation.input;
      if (resolver === undefined || resolver === null || typeof resolver.for !== 'function') return undefined;
      const input = resolver.for(actx); // throws unless actx is a retained session scope
      const store = input === undefined || input === null ? undefined : input.state;
      if (store === undefined || store === null || typeof store.getSnapshot !== 'function') return undefined;
      const state = store.getSnapshot();
      const ids = state === undefined || state === null ? undefined : state.attachmentIds;
      if (!Array.isArray(ids)) return undefined;
      const out = [];
      for (const id of ids) out.push(String(id));
      return out;
    }

    // --------------------------------- 2. non-contract enrichment (guarded)

    /** conversation.resolveDraftAttachments(ids) — typeof-guarded; undefined = degraded mode. */
    function resolveDraftList(conversation, ids) {
      if (conversation === undefined || conversation === null) return undefined;
      if (ids.length === 0) return undefined;
      const resolve = conversation.resolveDraftAttachments;
      if (typeof resolve !== 'function') {
        warnOnce('resolveDraftAttachments missing — degraded to ordinal-only rows');
        return undefined;
      }
      let list;
      try {
        list = resolve.call(conversation, ids);
      } catch (error) {
        warnOnce('resolveDraftAttachments threw — degraded to ordinal-only rows', error);
        return undefined;
      }
      if (!Array.isArray(list)) {
        warnOnce('resolveDraftAttachments returned a non-array — degraded to ordinal-only rows');
        return undefined;
      }
      return list;
    }

    /**
     * ids in draft order -> rows. Alignment is by each element's own `id`, never by index:
     * the resolver drops ids it no longer holds, so its array may be shorter than `ids`.
     */
    function describeDrafts(ids, list) {
      const byId = new Map();
      if (list !== undefined) {
        for (const attachment of list) {
          if (attachment === undefined || attachment === null) continue;
          const key = String(attachment.id);
          if (!byId.has(key)) byId.set(key, attachment);
        }
      }
      const items = [];
      let ordinal = 0;
      for (const id of ids) {
        const attachment = byId.get(id);
        const isFile = attachment !== undefined && attachment.kind === 'file';
        if (!isFile) ordinal += 1;
        items.push({
          id: id,
          ordinal: isFile ? 0 : ordinal,
          isImage: !isFile,
          resolved: attachment !== undefined,
          name: attachment === undefined ? undefined : normalizeName(attachment.file === undefined || attachment.file === null ? undefined : attachment.file.name),
          previewUrl: attachment === undefined || typeof attachment.previewUrl !== 'string' || attachment.previewUrl === '' ? undefined : attachment.previewUrl,
          width: attachment === undefined ? undefined : positiveInt(attachment.width),
          height: attachment === undefined ? undefined : positiveInt(attachment.height),
        });
      }
      return items;
    }

    /**
     * Remember the draft. The submit path clears attachmentIds *before* serialization
     * (ui-conversation client.js:13934-13935), so the empty state must never overwrite
     * the snapshot the codec needs at submit time.
     */
    function rememberDrafts(sessionId, ids, items) {
      if (ids.length === 0) return;
      const images = [];
      for (const item of items) {
        if (item.isImage) images.push({ id: item.id, ordinal: item.ordinal, name: item.name, previewUrl: item.previewUrl });
      }
      draftCache.set(sessionId, { ids: ids.slice(), images: images });
    }

    /** Live image ordinal for one attachment id, across sessions (ids are unique). */
    function findLiveImage(id) {
      for (const entry of draftCache.values()) {
        for (const image of entry.images) {
          if (image.id === id) return image;
        }
      }
      return undefined;
    }

    /**
     * Preview URL of one draft attachment. The live resolver wins while the draft still holds
     * the id (freshest URL, and it survives the blob being re-issued); the remembered snapshot
     * is the fallback for the window where the submit path has already cleared the draft.
     */
    function previewUrlFor(ctx, session, id) {
      const sessionId = session === undefined || session === null ? undefined : String(session.sessionId);
      if (sessionId !== undefined && sessionId !== '') {
        let ids;
        try {
          ids = readDraftIds(ctx, sessionId);
        } catch (error) {
          warnOnce('draft read failed on chip activation', error);
          ids = undefined;
        }
        if (Array.isArray(ids) && ids.indexOf(id) !== -1) {
          const items = describeDrafts([id], resolveDraftList(safeGet(ctx, 'conversation'), [id]));
          if (items.length > 0 && items[0].previewUrl !== undefined) return items[0].previewUrl;
        }
      }
      const remembered = findLiveImage(id);
      return remembered === undefined ? undefined : remembered.previewUrl;
    }

    const PREVIEW_ID = 'dsh-image-mention-preview';

    /**
     * Click-to-preview overlay for one reference chip. Plain DOM on purpose: the chip is the
     * only affordance left that answers "which image is this", and building it from the
     * `ImageLightbox` primitive would need a client-module import that may not resolve.
     */
    function showImagePreview(url, name) {
      if (typeof document === 'undefined' || document === null) return;
      const existing = document.getElementById(PREVIEW_ID);
      if (existing !== undefined && existing !== null) existing.remove();
      const overlay = document.createElement('div');
      overlay.id = PREVIEW_ID;
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('style', 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);cursor:zoom-out;padding:24px;box-sizing:border-box');
      const frame = document.createElement('div');
      frame.setAttribute('style', 'display:flex;flex-direction:column;align-items:center;gap:10px;max-width:100%;max-height:100%');
      const image = document.createElement('img');
      image.src = url;
      image.alt = name === undefined ? '' : name;
      image.setAttribute('style', 'max-width:100%;max-height:calc(100vh - 96px);border-radius:8px;box-shadow:0 12px 48px rgba(0,0,0,.5)');
      frame.appendChild(image);
      if (name !== undefined) {
        const caption = document.createElement('div');
        caption.textContent = name;
        caption.setAttribute('style', 'color:#fff;opacity:.85;font-size:13px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
        frame.appendChild(caption);
      }
      overlay.appendChild(frame);
      const onKey = (event) => {
        if (event.key === 'Escape') close();
      };
      function close() {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
      }
      overlay.addEventListener('click', close);
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
    }

    // ------------------------------------------------------- 3. ref codec

    /** ref = 'img:' + ordinalAtPick + ':' + attachmentId + ':' + encodeURIComponent(name) */
    function encodeRef(item) {
      return REF_PREFIX + String(item.ordinal) + ':' + item.id + ':' + encodeURIComponent(item.name === undefined ? '' : item.name);
    }

    /**
     * The attachment id itself contains ':' (sha256:…), while encodeURIComponent always escapes
     * ':' inside the name — so the index ends at the FIRST colon and the id/name split is the LAST.
     */
    function parseRef(ref) {
      if (typeof ref !== 'string' || ref.slice(0, REF_PREFIX.length) !== REF_PREFIX) return undefined;
      const rest = ref.slice(REF_PREFIX.length);
      const first = rest.indexOf(':');
      if (first === -1) return undefined;
      const rawIndex = Number(rest.slice(0, first));
      const body = rest.slice(first + 1);
      const last = body.lastIndexOf(':');
      if (last <= 0) return undefined;
      const encoded = body.slice(last + 1);
      let name;
      try {
        name = encoded === '' ? undefined : decodeURIComponent(encoded);
      } catch (error) {
        name = undefined;
      }
      return {
        id: body.slice(0, last),
        index: isFinite(rawIndex) && rawIndex > 0 ? Math.round(rawIndex) : 1,
        name: normalizeName(name),
      };
    }

    /** The anchor the model reads: quoted name matches the platform's JSON.stringify(name) handle form. */
    function renderAnchor(ordinal, name) {
      const position = ordinal > 0 ? ordinal : 1;
      if (name === undefined) return '【本条消息第 ' + position + ' 张图】';
      return '【本条消息第 ' + position + ' 张图：' + JSON.stringify(name) + '】';
    }

    // ------------------------------------------------- 4. menu presentation

    /**
     * The menu renders a component icon as jsx(item.icon, { size: 14 }) inside a hard 14x14 box
     * that has no overflow:hidden, while the row content box is ~22px (min-height 34px, padding
     * 6px 8px) — so a 22px thumbnail overflows the glyph slot into the row padding by design.
     */
    function thumbnailIcon(previewUrl) {
      let component = iconCache.get(previewUrl);
      if (component !== undefined) return component;
      component = function ImageMentionThumbnail() {
        return React.createElement('img', {
          src: previewUrl,
          alt: '',
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          draggable: false,
          style: {
            width: THUMB_SIZE + 'px',
            height: THUMB_SIZE + 'px',
            borderRadius: '4px',
            objectFit: 'cover',
            flex: 'none',
            display: 'block',
          },
        });
      };
      if (iconCache.size >= MAX_ICONS) iconCache.clear();
      iconCache.set(previewUrl, component);
      return component;
    }

    function composeDescription(item) {
      const parts = [];
      if (item.name !== undefined) parts.push(item.name);
      if (item.width !== undefined && item.height !== undefined) parts.push(item.width + '×' + item.height);
      return parts.length === 0 ? undefined : parts.join(' · ');
    }

    /** The pick payload carries the ref in `value`; `name` stays a plain display label. */
    function toCandidate(item) {
      const candidate = {
        name: '第 ' + item.ordinal + ' 张图',
        value: encodeRef(item),
      };
      const description = composeDescription(item);
      if (description !== undefined) candidate.description = description;
      candidate.icon = item.previewUrl === undefined ? 'file' : thumbnailIcon(item.previewUrl);
      return candidate;
    }

    /** The pipeline polls every '@' source for every query, so the source filters its own rows. */
    function matchesQuery(candidate, item, query) {
      if (candidate.name.toLowerCase().indexOf(query) !== -1) return true;
      if (item.name !== undefined && item.name.toLowerCase().indexOf(query) !== -1) return true;
      return candidate.description !== undefined && candidate.description.toLowerCase().indexOf(query) !== -1;
    }

    function chipLabel(parsed) {
      if (parsed.name === undefined) return '第 ' + parsed.index + ' 张图';
      return '图 ' + parsed.name;
    }

    // ------------------------------------------------------- 5. the source

    function createSource(ctx) {
      return {
        trigger: '@',
        name: SOURCE_NAME,
        order: -10,
        showGroupTitle: true,

        async candidates(session, req) {
          const sessionId = session === undefined || session === null ? undefined : String(session.sessionId);
          if (sessionId === undefined || sessionId === '') return [];

          let ids;
          try {
            ids = readDraftIds(ctx, sessionId);
          } catch (error) {
            warnOnce('draft read failed', error);
            return [];
          }
          if (ids === undefined || ids.length === 0) return []; // empty draft: no rows, no empty group

          const conversation = safeGet(ctx, 'conversation');
          let list;
          try {
            list = resolveDraftList(conversation, ids);
          } catch (error) {
            warnOnce('draft metadata failed — degraded to ordinal-only rows', error);
            list = undefined;
          }
          const items = describeDrafts(ids, list);
          rememberDrafts(sessionId, ids, items);

          const rows = [];
          for (const item of items) {
            if (item.isImage) rows.push(item);
          }
          if (rows.length === 0) return [];

          const query = req === undefined || req === null || typeof req.query !== 'string' ? '' : req.query.trim().toLowerCase();
          const out = [];
          for (const item of rows) {
            const candidate = toCandidate(item);
            if (query === '' || matchesQuery(candidate, item, query)) out.push(candidate);
          }
          return out;
        },

        onPick(pick) {
          const candidate = pick === undefined || pick === null ? undefined : pick.candidate;
          const ref = candidate === undefined || candidate === null ? undefined : candidate.value;
          if (typeof ref !== 'string' || ref === '') return undefined;
          const parsed = parseRef(ref);
          if (parsed === undefined) return undefined;
          return {
            insert: {
              source: SOURCE_NAME, // must equal this source's name: serializeReference() finds the codec by name
              ref: ref,
              label: chipLabel(parsed),
              appearance: 'file',
              clipboardText: '@image:' + parsed.index,
            },
          };
        },

        /**
         * Chip activation (`dsh-client-ui-input-trigger` roster lookup by owner name).
         * Returning false preserves the platform's ordinary editor handling, so a chip
         * whose preview URL is unknown stays inert instead of failing loudly.
         */
        openReference(session, reference) {
          const ref = reference === undefined || reference === null ? undefined : reference.ref;
          const parsed = parseRef(ref);
          if (parsed === undefined) return false;
          const url = previewUrlFor(ctx, session, parsed.id);
          if (url === undefined) return false;
          showImagePreview(url, parsed.name);
          return true;
        },

        codec: {
          clipboardText(ref) {
            const parsed = parseRef(ref);
            return parsed === undefined ? '@image' : '@image:' + parsed.index;
          },

          async serialize(ref) {
            const parsed = parseRef(ref);
            if (parsed === undefined) return '【本条消息中的一张图片】';
            const live = findLiveImage(parsed.id);
            const ordinal = live !== undefined && live.ordinal > 0 ? live.ordinal : parsed.index;
            const name = live !== undefined && live.name !== undefined ? live.name : parsed.name;
            return renderAnchor(ordinal, name);
          },
        },
      };
    }

    // ---------------------------------------------------------- 6. the plugin

    function apply(ctx) {
      const inputTriggers = safeGet(ctx, 'inputTriggers');
      if (inputTriggers === undefined || inputTriggers === null || typeof inputTriggers.registerSource !== 'function') {
        warnOnce('inputTriggers service unavailable — @ image source not registered');
        return;
      }
      const source = createSource(ctx);
      ctx.effect(() => inputTriggers.registerSource(source), 'dsh-image-mention: @ image source');
      console.info('[dsh-image-mention] @ image source registered');
    }

    const inject = ['inputTriggers', 'conversation'];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
