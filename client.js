/**
 * dsh-archive-purge — Client half.
 *
 * Three jobs, all in the browser:
 *
 *  1. **Keep archived sessions out of the conversation list.** Two independent
 *     mechanisms, because neither alone is a guarantee: a stylesheet that hides
 *     every archived session row by its own `data-row-key` (the sidebar keeps
 *     rendering those rows whenever its “归档显示” filter is set to show
 *     archived), and a reset of that persisted filter back to its shipped
 *     default so the menu stops claiming otherwise.
 *  2. **A management surface.** One global panel — a sidebar icon plus the
 *     centre column — listing every archived session with its workspace, path,
 *     disk footprint and time, offering restore and permanent delete.
 *  3. **The destructive step itself.** The panel only ever asks the Host half;
 *     this file never touches the filesystem.
 *
 * @module dsh-archive-purge/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-archive-purge',
  factory(require) {
    const module = { exports: {} }
    const React = require('react')

    /** Services this client half consumes. Optional faces are read with `ctx.get`. */
    const inject = ['slots', 'locale']

    /** Panel id: the sidebar entry id and the `main` slot key are the same cell key. */
    const PANEL_ID = 'archive-purge'
    /** Locale namespace owned by this plugin. */
    const NS = 'archive-purge'
    /** Host-half route prefix. */
    const API = '/api/archive-purge'
    /** The shipped workspace-browser view store; its archived filter persists here. */
    const VIEW_STORE_KEY = 'dsh.workspace.view.v5'
    /** The shipped default: archived rows stay out of the conversation list. */
    const ARCHIVED_FILTER_DEFAULT = 'default'
    /**
     * Archived rows and archived search results carry this accessible
     * description in the locales the product ships. Matching it keeps the hide
     * rule working even before the archived id list has been read.
     */
    const ARCHIVED_DESCRIPTION_SELECTORS = [
      '[aria-description="已归档对话暂时无法查看，请取消归档后查看"]',
      '[aria-description="Archived sessions cannot be opened. Unarchive it to view."]',
    ].join(',')

    /** Stable snapshot selectors: `useSyncExternalStore` compares by identity. */
    const selectSelf = (snapshot) => snapshot
    const selectArchivedIds = (snapshot) => snapshot?.archivedSessionIds
    const selectWorkspaceItems = (snapshot) => snapshot?.items

    const DICT = {
      zh: {
        panel: '已归档管理',
        title: '已归档管理',
        subtitle: '共 {count} 个已归档会话 · 磁盘占用 {size}',
        subtitleOne: '共 {count} 个已归档会话 · 磁盘占用 {size}',
        subtitleEmpty: '暂无已归档会话',
        refresh: '刷新',
        refreshing: '读取中…',
        search: '搜索标题、工作区或路径',
        clearSearch: '清除搜索',
        selectAll: '全选',
        clearSelection: '取消选择',
        selected: '已选 {count} 项',
        restore: '取消归档',
        restoreSelected: '取消归档所选',
        delete: '彻底删除',
        deleteSelected: '彻底删除所选',
        purge: '清理登记',
        done: '已完成。',
        loading: '正在读取归档清单…',
        loadFailed: '读取归档清单失败：{message}',
        retry: '重试',
        emptyTitle: '暂无已归档会话',
        emptyHint: '在会话行的“…”菜单里选择“归档会话”，它会从会话列表消失并出现在本页。',
        noMatchTitle: '没有匹配的会话',
        noMatchHint: '试试更短的关键词，或清除搜索。',
        unknownTitle: '未命名会话',
        noWorkspace: '未分组',
        liveRunning: '运行中',
        liveAgent: 'Agent 持有',
        missingLog: '日志不在磁盘上',
        childCount: '{count} 个子会话',
        childCountOne: '{count} 个子会话',
        metaFiles: '{count} 个文件',
        metaFilesOne: '{count} 个文件',
        metaCache: '含投影缓存 {size}',
        confirmTitle: '彻底删除 {count} 个已归档会话？',
        confirmTitleOne: '彻底删除 {count} 个已归档会话？',
        confirmIrreversible: '此操作不可恢复：会话记录、对话历史与标题都不会再出现在 DSH 中。',
        confirmRemoves: '将删除会话日志目录（合计 {size}）、归档与置顶登记、投影缓存记录。',
        confirmMissing: '其中 {count} 项在磁盘上已无日志，只会清理它们的归档登记。',
        confirmMissingOne: '其中 {count} 项在磁盘上已无日志，只会清理它的归档登记。',
        confirmList: '即将删除',
        confirmMore: '…另有 {count} 项',
        cancel: '取消',
        confirmAction: '彻底删除',
        working: '正在删除…',
        restored: '已取消归档 {count} 项，它们已回到会话列表。',
        restoredOne: '已取消归档 {count} 项，它已回到会话列表。',
        deleted: '已彻底删除 {count} 项，释放 {size}。',
        purged: '已清理 {count} 项失效登记。',
        purgedOne: '已清理 {count} 项失效登记。',
        refusedLive: '{count} 项仍由本进程中的 Agent 持有，已跳过。',
        refusedActive: '{count} 项仍有进行中的工作，已跳过。',
        refusedActiveOne: '{count} 项仍有进行中的工作，已跳过。',
        failedCount: '{count} 项删除失败。',
        reasonLive: '该会话仍由本进程中的 Agent 持有（可能已打开写入句柄）：请重启 DSH 后再删除。',
        reasonActive: '该会话仍有进行中的工作：请先停止这些工作再删除。',
        reasonOther: '宿主侧拒绝：{reason}',
        footerNote: '彻底删除只移除日志目录、归档/置顶登记与投影缓存；附件目录按内容寻址、可能与其它会话共享，因此保留。侧栏“视图选项 → 归档显示”固定为“隐藏已归档”，已归档会话只在本面板管理。',
        ghostsHidden: '另有 {count} 行属于「会话已删除、界面仍缓存」的残留，已一并隐藏；刷新页面即可彻底清除。',
        ghostsHiddenOne: '另有 {count} 行属于「会话已删除、界面仍缓存」的残留，已一并隐藏；刷新页面即可彻底清除。',
      },
      en: {
        panel: 'Archived sessions',
        title: 'Archived sessions',
        subtitle: '{count} archived sessions · {size} on disk',
        subtitleOne: '{count} archived session · {size} on disk',
        subtitleEmpty: 'No archived sessions',
        refresh: 'Refresh',
        refreshing: 'Reading…',
        search: 'Search title, workspace, or path',
        clearSearch: 'Clear search',
        selectAll: 'Select all',
        clearSelection: 'Clear selection',
        selected: '{count} selected',
        restore: 'Unarchive',
        restoreSelected: 'Unarchive selected',
        delete: 'Delete permanently',
        deleteSelected: 'Delete selected',
        purge: 'Clear record',
        done: 'Done.',
        loading: 'Reading the archive…',
        loadFailed: 'Could not read the archive: {message}',
        retry: 'Retry',
        emptyTitle: 'No archived sessions',
        emptyHint: 'Choose “Archive session” in a session row’s “…” menu; it leaves the conversation list and shows up here.',
        noMatchTitle: 'Nothing matches',
        noMatchHint: 'Try a shorter query, or clear the search.',
        unknownTitle: 'Untitled session',
        noWorkspace: 'Ungrouped',
        liveRunning: 'Running',
        liveAgent: 'Agent attached',
        missingLog: 'No log on disk',
        childCount: '{count} child sessions',
        childCountOne: '{count} child session',
        metaFiles: '{count} files',
        metaFilesOne: '{count} file',
        metaCache: 'incl. {size} projection cache',
        confirmTitle: 'Permanently delete {count} archived sessions?',
        confirmTitleOne: 'Permanently delete {count} archived session?',
        confirmIrreversible: 'This cannot be undone: the session, its history, and its title will be gone from DSH.',
        confirmRemoves: 'Removes the session log directories ({size}), the archive and pin records, and the projection-cache records.',
        confirmMissing: '{count} of them have no log on disk; only their archive records are cleared.',
        confirmMissingOne: '{count} of them has no log on disk; only its archive record is cleared.',
        confirmList: 'About to delete',
        confirmMore: '…and {count} more',
        cancel: 'Cancel',
        confirmAction: 'Delete permanently',
        working: 'Deleting…',
        restored: 'Unarchived {count}; they are back in the conversation list.',
        restoredOne: 'Unarchived {count}; it is back in the conversation list.',
        deleted: 'Permanently deleted {count}, freeing {size}.',
        purged: 'Cleared {count} stale records.',
        purgedOne: 'Cleared {count} stale record.',
        refusedLive: 'Skipped {count} still held by an Agent in this process.',
        refusedActive: 'Skipped {count} that still own work in progress.',
        refusedActiveOne: 'Skipped {count} that still owns work in progress.',
        failedCount: '{count} failed to delete.',
        reasonLive: 'The session is still held by an Agent in this process (it may own the log write handle): restart DSH, then delete.',
        reasonActive: 'The session still owns work in progress: stop that work first.',
        reasonOther: 'The host refused: {reason}',
        footerNote: 'Permanent delete removes the log directory, the archive/pin records, and the projection cache. Attachments are content-addressed and may be shared, so they are kept. The sidebar’s “View options → Archived” filter is pinned to “Hide archived”: archived sessions are managed in this panel only.',
        ghostsHidden: '{count} more rows are leftovers — the session is deleted but this browser still caches it. Hidden as well; a page reload clears them for good.',
        ghostsHiddenOne: '1 more row is a leftover — the session is deleted but this browser still caches it. Hidden as well; a page reload clears it for good.',
      },
    }

    /**
     * Icon geometry copied from `@deepseek-ai/dsh-client-ui-primitives` so the
     * panel matches the product's own icon set without importing it.
     */
    const ICONS = {
      archive: [
        { d: 'M13.5 2.5H2.5C1.94772 2.5 1.5 2.94772 1.5 3.5V4.5C1.5 5.05228 1.94772 5.5 2.5 5.5H13.5C14.0523 5.5 14.5 5.05228 14.5 4.5V3.5C14.5 2.94772 14.0523 2.5 13.5 2.5Z' },
        { d: 'M2.5 5.5V13.5C2.5 13.7652 2.60536 14.0196 2.79289 14.2071C2.98043 14.3946 3.23478 14.5 3.5 14.5H12.5C12.7652 14.5 13.0196 14.3946 13.2071 14.2071C13.3946 14.0196 13.5 13.7652 13.5 13.5V5.5' },
        { d: 'M6.5 9.5H9.5' },
      ],
      trash: [
        { d: 'M1.28149 3.88831H14.7187' },
        { d: 'M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833' },
        { d: 'M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831' },
        { d: 'M6.44946 6.98926V11.1238' },
        { d: 'M9.55054 6.98926V11.1238' },
      ],
      search: [
        { d: 'M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z' },
        { d: 'M10.2991 10.3933L14.7783 14.8725' },
      ],
      refresh: [
        { d: 'M13.5 8C13.5 11.0376 11.0376 13.5 8 13.5C4.96243 13.5 2.5 11.0376 2.5 8C2.5 4.96243 4.96243 2.5 8 2.5C9.74085 2.5 11.2939 3.30819 12.2879 4.56839' },
        { d: 'M12.6 1.8V4.9H9.5' },
      ],
      close: [{ d: 'M2.5 2.5L13.5 13.5' }, { d: 'M13.5 2.5L2.5 13.5' }],
      alert: [
        { d: 'M8 1.75L15 14.25H1L8 1.75Z' },
        { d: 'M8 6V9.75' },
        { d: 'M8 11.75V12.25' },
      ],
    }

    /**
     * Render one product-style outline icon.
     * @param props - `name`, `size`, and an optional className.
     * @returns the icon element.
     */
    function Icon(props) {
      const paths = ICONS[props.name]
      if (paths === undefined) return null
      const size = props.size ?? 16
      return React.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
        focusable: 'false',
        className: props.className,
      }, paths.map((path, index) => React.createElement('path', {
        key: index,
        d: path.d,
        stroke: 'currentColor',
        strokeWidth: 1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })))
    }

    /**
     * A minimal observable handing a delete request from the panel to the
     * frame-wide confirm dialog.
     * @param initial - the initial value.
     * @returns get/set/subscribe.
     */
    function createSignal(initial) {
      let value = initial
      const listeners = new Set()
      return {
        get: () => value,
        set: (next) => {
          value = next
          for (const listener of [...listeners]) listener()
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    /**
     * Bind a bare observable snapshot source to `useSyncExternalStore`.
     * @param source - an object exposing `getSnapshot`/`subscribe`, or undefined.
     * @param select - a module-stable selector.
     * @returns the selected value, or undefined without a source.
     */
    function useSource(source, select) {
      const subscribe = React.useCallback((onChange) => {
        if (source === undefined || typeof source.subscribe !== 'function') return () => {}
        return source.subscribe(onChange)
      }, [source])
      const read = React.useCallback(() => {
        if (source === undefined || typeof source.getSnapshot !== 'function') return undefined
        return select(source.getSnapshot())
      }, [source, select])
      return React.useSyncExternalStore(subscribe, read, read)
    }

    /**
     * Read the framework's own standard hook when the slot provides one, and
     * fall back to the client service snapshot otherwise. The decision is frozen
     * on the first render so the hook order can never change for one entry.
     * @param standardHook - the slot-provided selector hook, when present.
     * @param source - the fallback observable source.
     * @param select - a module-stable selector.
     * @returns the selected value.
     */
    function useSelected(standardHook, source, select) {
      const frozen = React.useRef(typeof standardHook === 'function' ? standardHook : undefined)
      const standard = frozen.current === undefined ? undefined : frozen.current(select)
      const fallback = useSource(source, select)
      return standard ?? fallback
    }

    /**
     * A stable facade over one client service's list snapshot. The service may
     * be provided after this plugin activates, so every read resolves it fresh
     * and a subscription retries briefly until the provider composes.
     * @param ctx - the client plugin context.
     * @param name - the client service name (`workspaces`, `sessions`).
     * @returns an observable snapshot source.
     */
    function createServiceFacade(ctx, name) {
      const listOf = () => ctx.get(name)?.list
      return {
        getSnapshot: () => listOf()?.getSnapshot?.(),
        subscribe: (listener) => {
          let dispose = () => {}
          let cancelled = false
          let handle
          const attach = () => {
            const list = listOf()
            if (list === undefined || typeof list.subscribe !== 'function') return false
            dispose = list.subscribe(listener)
            return true
          }
          if (!attach()) {
            let attempts = 0
            handle = window.setInterval(() => {
              attempts += 1
              if (attach() || attempts > 40) {
                window.clearInterval(handle)
                if (cancelled) dispose()
              }
            }, 250)
          }
          return () => {
            cancelled = true
            if (handle !== undefined) window.clearInterval(handle)
            dispose()
          }
        },
      }
    }

    /**
     * Escape a value for use inside a CSS attribute selector string.
     * @param value - the raw attribute value.
     * @returns the escaped value.
     */
    function cssAttributeValue(value) {
      return String(value).replace(/["\\]/g, '\\$&')
    }

    /**
     * Format a byte count for humans.
     * @param bytes - the size in bytes.
     * @returns a short size label.
     */
    function formatBytes(bytes) {
      const value = Number(bytes)
      if (!Number.isFinite(value) || value <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let index = 0
      let scaled = value
      while (scaled >= 1024 && index < units.length - 1) {
        scaled /= 1024
        index += 1
      }
      const rounded = scaled >= 10 || index === 0 ? Math.round(scaled) : Math.round(scaled * 10) / 10
      return `${rounded} ${units[index]}`
    }

    /**
     * Format an epoch timestamp as a compact relative label.
     * @param timestamp - epoch milliseconds.
     * @param now - current epoch milliseconds.
     * @param english - whether the active locale is English.
     * @returns the relative label.
     */
    function formatRelative(timestamp, now, english) {
      const value = Number(timestamp)
      if (!Number.isFinite(value) || value <= 0) return ''
      const minutes = Math.floor(Math.max(0, now - value) / 60000)
      if (minutes < 1) return english ? 'just now' : '刚刚'
      if (minutes < 60) return english ? `${minutes}m ago` : `${minutes} 分钟前`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return english ? `${hours}h ago` : `${hours} 小时前`
      const days = Math.floor(hours / 24)
      if (days < 30) return english ? `${days}d ago` : `${days} 天前`
      const date = new Date(value)
      return english
        ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
        : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
    }

    /**
     * Interpolate `{name}` placeholders.
     * @param template - the dictionary string.
     * @param values - replacement values.
     * @returns the interpolated string.
     */
    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) => (
        Object.hasOwn(values, key) ? String(values[key]) : match
      ))
    }

    /**
     * Pick the singular template for a count of exactly one, so an English
     * reader never sees “1 files”. A dictionary without the singular key keeps
     * the plural one — Chinese reuses the same wording either way — and the
     * translator returns the key itself when it is missing, which is how the
     * miss is detected.
     * @param t - the bound translator.
     * @param key - dictionary key holding the plural template.
     * @param count - the number being described.
     * @returns the template to interpolate.
     */
    function countTemplate(t, key, count) {
      if (count !== 1) return t(key)
      const singularKey = `${key}One`
      const singular = t(singularKey)
      return singular === singularKey ? t(key) : singular
    }

    /**
     * Read the persisted sidebar view state and force the archived filter back
     * to its shipped default, so the browser stops asking for archived rows.
     * @returns the filter value that was replaced, when one was.
     */
    function resetArchivedFilter() {
      try {
        const raw = window.localStorage.getItem(VIEW_STORE_KEY)
        if (raw === null) return undefined
        const state = JSON.parse(raw)
        if (state === null || typeof state !== 'object') return undefined
        const current = state.archivedFilter
        if (current === undefined || current === ARCHIVED_FILTER_DEFAULT) return undefined
        state.archivedFilter = ARCHIVED_FILTER_DEFAULT
        window.localStorage.setItem(VIEW_STORE_KEY, JSON.stringify(state))
        return current
      } catch {
        return undefined
      }
    }

    /**
     * Build the stylesheet: static chrome, then the live hide rule for exactly
     * the sessions the registry reports archived.
     * @param archivedIds - the current archived session ids.
     * @returns the complete CSS text.
     */
    function buildCss(archivedIds) {
      const exact = archivedIds.length === 0
        ? ''
        : `${archivedIds.map((id) => `[data-row-key="session:${cssAttributeValue(id)}"]`).join(',')}{display:none!important}`
      return `
.am-root{flex:1;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.am-head{flex:none;display:flex;align-items:flex-start;gap:12px;padding:18px 24px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.am-head-main{flex:1;min-width:0}
.am-title{font-size:16px;font-weight:650;line-height:22px}
.am-sub{margin-top:3px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.am-ghost-note{color:var(--dsw-alias-state-warn-primary)}
.am-head-actions{flex:none;display:flex;align-items:center;gap:8px}
.am-toolbar{flex:none;display:flex;align-items:center;gap:10px;padding:12px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.am-search{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.am-search:focus-within{border-color:var(--dsw-alias-brand-primary)}
.am-search input{flex:1;min-width:0;height:100%;border:0;outline:0;background:transparent;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary)}
.am-search input::placeholder{color:var(--dsw-alias-label-secondary)}
.am-toolbar-side{flex:none;display:flex;align-items:center;gap:8px}
.am-selected{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
.am-body{flex:1;min-height:0;overflow:auto;padding:8px 16px 16px}
.am-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;min-height:220px;color:var(--dsw-alias-label-secondary);text-align:center}
.am-empty-title{font-size:14px;color:var(--dsw-alias-label-primary)}
.am-empty-hint{font-size:12px;max-width:420px;line-height:18px}
.am-notice{margin:8px 8px 4px;padding:9px 12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.am-notice.warn{color:var(--dsw-alias-state-warn-primary)}
.am-notice.error{color:var(--dsw-alias-state-error-primary)}
.am-notice-list{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px}
.am-notice-list li{display:flex;gap:8px;justify-content:space-between;font-size:11.5px}
.am-notice-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.am-notice-list li span:last-child{flex:1 1 auto;text-align:right}
.am-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--dsw-radius-md,8px);border:1px solid transparent}
.am-row:hover{background:var(--dsw-alias-bg-layer-1)}
.am-row[data-selected=true]{background:var(--dsw-alias-bg-layer-2)}
.am-check{flex:none;display:flex;align-items:center;justify-content:center;width:20px;height:20px}
.am-check input{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer;margin:0}
.am-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.am-row-title{font-size:13px;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.am-row-meta{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.am-row-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:3px}
.am-badge{font-size:10.5px;line-height:1;padding:3px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.am-badge.warn{color:var(--dsw-alias-state-warn-primary)}
.am-badge.error{color:var(--dsw-alias-state-error-primary)}
.am-row-side{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-size:11.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;min-width:96px}
.am-row-actions{flex:none;display:flex;align-items:center;gap:6px}
.am-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.am-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.am-btn:disabled{opacity:.45;cursor:default}
.am-btn.primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff}
.am-btn.danger{color:var(--dsw-alias-state-error-primary)}
.am-btn.danger:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-state-error-primary)}
.am-btn.icon{width:28px;padding:0;justify-content:center}
.am-btn:focus-visible,.am-search:focus-within{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.am-foot{flex:none;padding:10px 24px 14px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.am-spin{animation:am-spin 1s linear infinite}
@keyframes am-spin{to{transform:rotate(360deg)}}
.am-scrim{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:32px;background:rgba(15,17,21,.42)}
.am-dialog{width:min(560px,100%);max-height:100%;display:flex;flex-direction:column;border-radius:var(--dsw-radius-lg,12px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:0 18px 48px rgba(0,0,0,.28);overflow:hidden}
.am-dialog-head{display:flex;align-items:flex-start;gap:10px;padding:16px 18px 10px}
.am-dialog-title{flex:1;font-size:14px;font-weight:650;line-height:20px}
.am-dialog-body{padding:0 18px 4px;overflow:auto;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary)}
.am-dialog-list{margin:10px 0 0;padding:8px 10px;list-style:none;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-primary)}
.am-dialog-list li{display:flex;justify-content:space-between;gap:12px;padding:2px 0}
.am-dialog-list li span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.am-dialog-list li span:last-child{flex:none;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.am-warn{margin-top:10px;color:var(--dsw-alias-state-error-primary)}
.am-dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding:14px 18px 16px}
@media(prefers-reduced-motion:reduce){.am-spin{animation:none}}
${ARCHIVED_DESCRIPTION_SELECTORS}{display:none!important}
${exact}
`
    }

    /**
     * The sidebar panel icon. Owner props: `{ size, active }`.
     * @param props - icon presentation supplied by the global panel row.
     * @returns the icon element.
     */
    function ArchivePanelIcon(props) {
      return React.createElement(Icon, { name: 'archive', size: props.size ?? 16 })
    }

    /**
     * Build the manager page bound to one plugin context.
     * @param ctx - the client plugin context.
     * @param t - the locale seat for this plugin's namespace.
     * @param requestDelete - opens the frame-wide confirm dialog.
     * @param localeSource - the locale snapshot source, for locale-aware formatting.
     * @param workspacesFallback - client-service fallback for `useWorkspaces`.
     * @param sessionsFallback - client-service fallback for `useSessions`.
     * @param hidden - `{ setGhosts, rememberDeleted }`, this page's contribution to the hide rule.
     * @returns the React component registered on the `main` slot.
     */
    function createManagerPage(ctx, t, requestDelete, localeSource, workspacesFallback, sessionsFallback, hidden) {
      return function ArchiveManagerPage(props) {
        const tSlot = props.t ?? t
        const localeSnapshot = useSource(localeSource, selectSelf)
        const english = localeSnapshot?.active === 'en'
        const workspacesSnapshot = useSelected(props.useWorkspaces, workspacesFallback, selectSelf)
        const sessionSnapshot = useSelected(props.useSessions, sessionsFallback, selectSelf)
        const [inventory, setInventory] = React.useState(null)
        const [status, setStatus] = React.useState('loading')
        const [error, setError] = React.useState('')
        const [query, setQuery] = React.useState('')
        const [selected, setSelected] = React.useState(() => new Set())
        const [busy, setBusy] = React.useState(false)
        const [notice, setNotice] = React.useState(null)
        const [ghostCount, setGhostCount] = React.useState(0)
        const [now, setNow] = React.useState(() => Date.now())

        const archivedIds = workspacesSnapshot?.archivedSessionIds ?? inventory?.archivedIds ?? []
        const archivedKey = archivedIds.join(',')

        // Rows the client still caches but the Host's persistence no longer
        // knows. Derived on every inventory read (never unioned) so an
        // unreadable listing cannot hide a session for good; a failed listing
        // is ignored outright.
        React.useEffect(() => {
          if (inventory === null) return
          if (inventory.listingError !== undefined && inventory.listingError !== null) return
          const known = new Set(Array.isArray(inventory.persistedIds) ? inventory.persistedIds : [])
          if (known.size === 0) return
          const cached = sessionSnapshot?.ids
          if (!Array.isArray(cached)) return
          const ghosts = cached.filter((id) => !known.has(id))
          hidden.setGhosts(ghosts)
          setGhostCount(ghosts.length)
        }, [inventory, sessionSnapshot, hidden])

        const refresh = React.useCallback(async () => {
          setStatus('loading')
          try {
            const response = await fetch(`${API}/inventory`, { cache: 'no-store' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            setInventory(await response.json())
            setStatus('ready')
            setError('')
          } catch (cause) {
            setStatus('error')
            setError(cause instanceof Error ? cause.message : String(cause))
          }
        }, [])

        React.useEffect(() => {
          refresh()
        }, [refresh, archivedKey])

        React.useEffect(() => {
          const handle = window.setInterval(() => setNow(Date.now()), 30000)
          return () => window.clearInterval(handle)
        }, [])

        const summaries = sessionSnapshot?.byId
        const rows = React.useMemo(() => {
          const diskById = new Map((inventory?.rows ?? []).map((row) => [row.id, row]))
          const workspaceItems = workspacesSnapshot?.items ?? []
          return archivedIds.map((id) => {
            const disk = diskById.get(id)
            const summary = summaries?.[id]
            const owner = disk?.workspaces?.[0]
            return {
              id,
              title: summary?.displayTitle ?? summary?.title ?? disk?.cwd ?? tSlot('unknownTitle'),
              cwd: disk?.cwd ?? summary?.cwd ?? '',
              workspace: owner?.title
                ?? workspaceItems.find((item) => item.sessionIds.includes(id))?.title
                ?? tSlot('noWorkspace'),
              updatedAt: summary?.updatedAt ?? disk?.createdAt ?? 0,
              sizeBytes: disk?.sizeBytes ?? 0,
              fileCount: disk?.fileCount ?? 0,
              cacheBytes: disk?.cacheBytes ?? 0,
              exists: disk?.exists ?? false,
              live: disk?.live ?? { attached: false, agent: false, running: false },
              childIds: disk?.childIds ?? [],
              dir: disk?.dir ?? null,
            }
          }).sort((left, right) => right.updatedAt - left.updatedAt)
        }, [archivedIds, inventory, summaries, workspacesSnapshot, tSlot])

        const visible = React.useMemo(() => {
          const needle = query.trim().toLowerCase()
          if (needle === '') return rows
          return rows.filter((row) => (
            row.title.toLowerCase().includes(needle)
            || row.workspace.toLowerCase().includes(needle)
            || row.cwd.toLowerCase().includes(needle)
            || row.id.toLowerCase().includes(needle)
          ))
        }, [rows, query])

        const selectedIds = React.useMemo(
          () => [...selected].filter((id) => rows.some((row) => row.id === id)),
          [selected, rows],
        )
        const totalBytes = inventory?.totalBytes ?? rows.reduce((sum, row) => sum + row.sizeBytes, 0)
        const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.id))

        const rowsFor = React.useCallback(
          (ids) => ids.map((id) => rows.find((row) => row.id === id)).filter((row) => row !== undefined),
          [rows],
        )

        const run = React.useCallback(async (operation, ids) => {
          if (ids.length === 0) return
          setBusy(true)
          setNotice(null)
          try {
            const response = await fetch(`${API}/${operation}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids }),
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            const results = Array.isArray(payload?.results) ? payload.results : []
            const done = results.filter((entry) => entry.status === 'deleted' || entry.status === 'restored')
            const refusedLive = results.filter((entry) => entry.status === 'refused' && entry.reason === 'live').length
            const refusedActive = results.filter((entry) => entry.status === 'refused' && entry.reason === 'active').length
            const failed = results.filter((entry) => entry.status === 'failed').length
            const parts = []
            if (operation === 'delete') {
              const purged = done.filter((entry) => entry.dir === null).length
              const erased = done.length - purged
              const freed = done.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0) + (entry.cacheBytes ?? 0), 0)
              if (erased > 0) parts.push(fill(tSlot('deleted'), { count: erased, size: formatBytes(freed) }))
              if (purged > 0) parts.push(fill(countTemplate(tSlot, 'purged', purged), { count: purged }))
              // The erased ids are hidden from now on even if the browser's
              // cached row outlives the removal event.
              if (done.length > 0) hidden.rememberDeleted(done.map((entry) => entry.id))
            } else if (done.length > 0) {
              parts.push(fill(countTemplate(tSlot, 'restored', done.length), { count: done.length }))
            }
            if (refusedLive > 0) parts.push(fill(tSlot('refusedLive'), { count: refusedLive }))
            if (refusedActive > 0) parts.push(fill(countTemplate(tSlot, 'refusedActive', refusedActive), { count: refusedActive }))
            if (failed > 0) parts.push(fill(tSlot('failedCount'), { count: failed }))
            // Name every session that did not go through, with the reason the
            // Host gave, so a refusal is actionable instead of just counted.
            const details = results
              .filter((entry) => entry.status === 'refused' || entry.status === 'failed')
              .map((entry) => {
                const row = rows.find((candidate) => candidate.id === entry.id)
                const activity = Array.isArray(entry.activity) && entry.activity.length > 0
                  ? `（${entry.activity.map((item) => item?.label ?? item?.kind ?? 'work').join(', ')}）`
                  : ''
                const reason = entry.reason === 'live'
                  ? tSlot('reasonLive')
                  : entry.reason === 'active'
                    ? `${tSlot('reasonActive')}${activity}`
                    : fill(tSlot('reasonOther'), { reason: String(entry.reason ?? '') })
                return { id: entry.id, title: row?.title ?? entry.id, reason }
              })
            setNotice({
              kind: refusedLive + refusedActive + failed > 0 ? 'warn' : 'info',
              text: parts.length > 0 ? parts.join(' ') : tSlot('done'),
              details,
            })
            setSelected(new Set())
          } catch (cause) {
            setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause), details: [] })
          } finally {
            setBusy(false)
            await refresh()
          }
        }, [hidden, refresh, rows, tSlot])

        const toggle = React.useCallback((id, on) => {
          setSelected((current) => {
            const next = new Set(current)
            if (on) next.add(id)
            else next.delete(id)
            return next
          })
        }, [])

        /**
         * Ask the frame-wide dialog to confirm; the confirmed ids come back to
         * this panel's own runner so the outcome is reported where it started.
         */
        const askDelete = React.useCallback((ids) => {
          const picked = rowsFor(ids)
          if (picked.length === 0) return
          requestDelete(picked, (confirmed) => run('delete', confirmed))
        }, [requestDelete, rowsFor, run])

        const header = React.createElement('div', { className: 'am-head' },
          React.createElement('div', { className: 'am-head-main' },
            React.createElement('div', { className: 'am-title' }, tSlot('title')),
            React.createElement('div', { className: 'am-sub' }, rows.length === 0
              ? tSlot('subtitleEmpty')
              : fill(countTemplate(tSlot, 'subtitle', rows.length), { count: rows.length, size: formatBytes(totalBytes) })),
            ghostCount > 0 && React.createElement('div', { className: 'am-sub am-ghost-note' },
              fill(countTemplate(tSlot, 'ghostsHidden', ghostCount), { count: ghostCount }))),
          React.createElement('div', { className: 'am-head-actions' },
            React.createElement('button', {
              type: 'button',
              className: 'am-btn',
              onClick: refresh,
              disabled: busy || status === 'loading',
              title: tSlot('refresh'),
            }, React.createElement(Icon, {
              name: 'refresh',
              size: 14,
              className: status === 'loading' ? 'am-spin' : undefined,
            }), tSlot(status === 'loading' ? 'refreshing' : 'refresh'))))

        const toolbar = React.createElement('div', { className: 'am-toolbar' },
          React.createElement('div', { className: 'am-search' },
            React.createElement(Icon, { name: 'search', size: 14 }),
            React.createElement('input', {
              type: 'search',
              name: 'archive-search',
              id: 'archive-purge-search',
              value: query,
              placeholder: tSlot('search'),
              'aria-label': tSlot('search'),
              onChange: (event) => setQuery(event.target.value),
            }),
            query !== '' && React.createElement('button', {
              type: 'button',
              className: 'am-btn icon',
              onClick: () => setQuery(''),
              title: tSlot('clearSearch'),
              'aria-label': tSlot('clearSearch'),
            }, React.createElement(Icon, { name: 'close', size: 12 }))),
          React.createElement('div', { className: 'am-toolbar-side' },
            selectedIds.length > 0 && React.createElement('span', { className: 'am-selected' },
              fill(tSlot('selected'), { count: selectedIds.length })),
            React.createElement('button', {
              type: 'button',
              className: 'am-btn',
              disabled: visible.length === 0,
              onClick: () => setSelected(allVisibleSelected
                ? new Set()
                : new Set(visible.map((row) => row.id))),
            }, allVisibleSelected ? tSlot('clearSelection') : tSlot('selectAll')),
            React.createElement('button', {
              type: 'button',
              className: 'am-btn',
              disabled: busy || selectedIds.length === 0,
              onClick: () => run('unarchive', selectedIds),
            }, tSlot('restoreSelected')),
            React.createElement('button', {
              type: 'button',
              className: 'am-btn danger',
              disabled: busy || selectedIds.length === 0,
              onClick: () => askDelete(selectedIds),
            }, tSlot('deleteSelected'))))

        const emptyState = React.createElement('div', { className: 'am-empty' },
          React.createElement(Icon, { name: 'archive', size: 28 }),
          React.createElement('div', { className: 'am-empty-title' },
            status === 'loading' ? tSlot('loading') : rows.length === 0 ? tSlot('emptyTitle') : tSlot('noMatchTitle')),
          React.createElement('div', { className: 'am-empty-hint' },
            status === 'error'
              ? fill(tSlot('loadFailed'), { message: error })
              : rows.length === 0 ? tSlot('emptyHint') : tSlot('noMatchHint')),
          status === 'error' && React.createElement('button', {
            type: 'button',
            className: 'am-btn primary',
            onClick: refresh,
          }, tSlot('retry')))

        const body = React.createElement('div', { className: 'am-body' },
          notice !== null && React.createElement('div', {
            className: `am-notice${notice.kind === 'info' ? '' : ` ${notice.kind}`}`,
            role: 'status',
          }, notice.text,
          Array.isArray(notice.details) && notice.details.length > 0 && React.createElement('ul', { className: 'am-notice-list' },
            notice.details.map((entry) => React.createElement('li', { key: entry.id },
              React.createElement('span', { className: 'am-notice-name' }, entry.title),
              React.createElement('span', null, entry.reason))))),
          visible.length === 0 ? emptyState : visible.map((row) => React.createElement(ArchiveRow, {
            key: row.id,
            row,
            now,
            english,
            busy,
            selected: selected.has(row.id),
            onToggle: toggle,
            onRestore: (id) => run('unarchive', [id]),
            onDelete: (id) => askDelete([id]),
            t: tSlot,
          })))

        const footer = React.createElement('div', { className: 'am-foot' }, tSlot('footerNote'))

        return React.createElement('div', { className: 'am-root' }, header, toolbar, body, footer)
      }
    }

    /**
     * One archived session row.
     * @param props - the row model plus its handlers.
     * @returns the row element.
     */
    function ArchiveRow(props) {
      const { row, now, english, busy, selected, onToggle, onRestore, onDelete, t } = props
      const badges = []
      if (row.live.running) badges.push(React.createElement('span', { key: 'running', className: 'am-badge warn', title: t('reasonActive') }, t('liveRunning')))
      else if (row.live.agent) badges.push(React.createElement('span', { key: 'agent', className: 'am-badge warn', title: t('reasonLive') }, t('liveAgent')))
      if (!row.exists) badges.push(React.createElement('span', { key: 'missing', className: 'am-badge error' }, t('missingLog')))
      if (row.childIds.length > 0) badges.push(React.createElement('span', { key: 'children', className: 'am-badge' }, fill(countTemplate(t, 'childCount', row.childIds.length), { count: row.childIds.length })))
      const files = row.exists ? fill(countTemplate(t, 'metaFiles', row.fileCount), { count: row.fileCount }) : ''
      const cache = row.cacheBytes > 0 ? fill(t('metaCache'), { size: formatBytes(row.cacheBytes) }) : ''
      const facts = [files, cache].filter((part) => part !== '').join(' · ')
      if (facts !== '') badges.push(React.createElement('span', { key: 'facts', className: 'am-badge' }, facts))

      const meta = [row.workspace, row.cwd].filter((part) => part !== undefined && part !== '').join(' · ')

      return React.createElement('div', {
        className: 'am-row',
        'data-selected': selected ? 'true' : 'false',
        'data-session-id': row.id,
      },
      React.createElement('label', { className: 'am-check' },
        React.createElement('input', {
          type: 'checkbox',
          name: 'archive-row-select',
          checked: selected,
          'aria-label': row.title,
          onChange: (event) => onToggle(row.id, event.target.checked),
        })),
      React.createElement('div', { className: 'am-row-main' },
        React.createElement('div', { className: 'am-row-title', title: row.title }, row.title),
        meta !== '' && React.createElement('div', { className: 'am-row-meta', title: row.cwd }, meta),
        React.createElement('div', { className: 'am-row-badges' }, badges)),
      React.createElement('div', { className: 'am-row-side' },
        React.createElement('span', null, row.exists ? formatBytes(row.sizeBytes) : '—'),
        React.createElement('span', null, formatRelative(row.updatedAt, now, english))),
      React.createElement('div', { className: 'am-row-actions' },
        React.createElement('button', {
          type: 'button',
          className: 'am-btn',
          disabled: busy,
          onClick: () => onRestore(row.id),
        }, t('restore')),
        React.createElement('button', {
          type: 'button',
          className: 'am-btn danger',
          disabled: busy,
          onClick: () => onDelete(row.id),
        }, React.createElement(Icon, { name: 'trash', size: 13 }), row.exists ? t('delete') : t('purge'))))
    }

    /**
     * Build the frame-wide confirm dialog for one delete request.
     *
     * The request carries the panel's own confirm action, so a confirmed delete
     * reports back through the panel that asked for it — the dialog is the
     * question, never the operator.
     * @param signal - the pending-request signal.
     * @param t - the locale seat.
     * @param fallbackConfirm - used only if a request arrives without its own action.
     * @returns the React component registered on `shell.overlay`.
     */
    function createDeleteDialog(signal, t, fallbackConfirm) {
      return function ArchiveDeleteDialog(props) {
        const tSlot = props.t ?? t
        const request = React.useSyncExternalStore(signal.subscribe, signal.get, signal.get)
        const [busy, setBusy] = React.useState(false)
        const cancelRef = React.useRef(null)

        React.useEffect(() => {
          if (request === null) return undefined
          cancelRef.current?.focus()
          const onKey = (event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            signal.set(null)
          }
          window.addEventListener('keydown', onKey, true)
          return () => window.removeEventListener('keydown', onKey, true)
        }, [request])

        if (request === null) return null
        const rows = request.rows
        const bytes = rows.reduce((sum, row) => sum + row.sizeBytes + row.cacheBytes, 0)
        const missing = rows.filter((row) => !row.exists).length
        const shown = rows.slice(0, 6)

        const confirm = async () => {
          setBusy(true)
          const ids = rows.map((row) => row.id)
          const action = typeof request.confirm === 'function' ? request.confirm : fallbackConfirm
          signal.set(null)
          try {
            await action(ids)
          } catch {
            /* the caller reports its own failure; the dialog is already gone */
          } finally {
            setBusy(false)
          }
        }

        return React.createElement('div', {
          className: 'am-scrim',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': fill(countTemplate(tSlot, 'confirmTitle', rows.length), { count: rows.length }),
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) signal.set(null)
          },
        }, React.createElement('div', { className: 'am-dialog' },
          React.createElement('div', { className: 'am-dialog-head' },
            React.createElement(Icon, { name: 'alert', size: 18 }),
            React.createElement('div', { className: 'am-dialog-title' },
              fill(countTemplate(tSlot, 'confirmTitle', rows.length), { count: rows.length }))),
          React.createElement('div', { className: 'am-dialog-body' },
            React.createElement('div', { className: 'am-warn' }, tSlot('confirmIrreversible')),
            React.createElement('div', null, fill(tSlot('confirmRemoves'), { size: formatBytes(bytes) })),
            missing > 0 && React.createElement('div', { className: 'am-warn' },
              fill(countTemplate(tSlot, 'confirmMissing', missing), { count: missing })),
            React.createElement('ul', { className: 'am-dialog-list' },
              React.createElement('li', null, React.createElement('span', null, tSlot('confirmList'))),
              shown.map((row) => React.createElement('li', { key: row.id },
                React.createElement('span', { title: row.cwd }, row.title),
                React.createElement('span', null, row.exists ? formatBytes(row.sizeBytes) : '—'))),
              rows.length > shown.length && React.createElement('li', null,
                React.createElement('span', null, fill(tSlot('confirmMore'), { count: rows.length - shown.length }))))),
          React.createElement('div', { className: 'am-dialog-actions' },
            React.createElement('button', {
              type: 'button',
              className: 'am-btn',
              ref: cancelRef,
              disabled: busy,
              onClick: () => signal.set(null),
            }, tSlot('cancel')),
            React.createElement('button', {
              type: 'button',
              className: 'am-btn danger',
              disabled: busy,
              onClick: confirm,
            }, React.createElement(Icon, { name: 'trash', size: 13 }),
            tSlot(busy ? 'working' : 'confirmAction')))))
      }
    }

    /**
     * Keep the hide rule in step with everything the panel knows is gone.
     *
     * Three sources, deliberately separate: the registry's archived set (the
     * shipped reason a row is hidden), the ghosts this session detected (derived
     * data, replaced on every inventory read so a bad reading self-corrects),
     * and the ids this page deleted itself (certain facts, unioned).
     *
     * Registered on `shell.overlay` — the one frame-wide seat that is always
     * mounted — so the rule stays current whichever main panel is selected.
     * Renders nothing.
     * @param style - this plugin's stylesheet element.
     * @param fallback - client-service fallback for `useWorkspaces`.
     * @param ghosts - signal of detected ghost session ids.
     * @param deleted - signal of session ids erased from this page.
     * @returns the React component registered on `shell.overlay`.
     */
    function createStyleGuard(style, fallback, ghosts, deleted) {
      return function ArchiveStyleGuard(props) {
        const snapshot = useSelected(props.useWorkspaces, fallback, selectSelf)
        const ghostIds = React.useSyncExternalStore(ghosts.subscribe, ghosts.get, ghosts.get)
        const deletedIds = React.useSyncExternalStore(deleted.subscribe, deleted.get, deleted.get)
        const archived = Array.isArray(snapshot?.archivedSessionIds) ? snapshot.archivedSessionIds : []
        const ids = [...new Set([...archived, ...ghostIds, ...deletedIds])]
        const key = ids.join(',')
        React.useEffect(() => {
          style.textContent = buildCss(ids)
        }, [key])
        return null
      }
    }

    /**
     * Mount the client half.
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      const deleteSignal = createSignal(null)
      /** Ghost ids: derived, replaced on every inventory read. */
      const ghostSignal = createSignal([])
      /** Ids this page erased: certain, unioned, never derived. */
      const deletedSignal = createSignal([])
      const hidden = {
        setGhosts: (ids) => ghostSignal.set(ids),
        rememberDeleted: (ids) => deletedSignal.set([...new Set([...deletedSignal.get(), ...ids])]),
      }
      const workspacesFallback = createServiceFacade(ctx, 'workspaces')
      const sessionsFallback = createServiceFacade(ctx, 'sessions')
      const localeSource = {
        getSnapshot: () => ctx.locale.getSnapshot(),
        subscribe: (listener) => ctx.locale.subscribe(listener),
      }

      // --- Stylesheet: static chrome plus the archived-row hide rule --------
      const style = document.createElement('style')
      style.dataset.dshArchiveManager = 'true'
      document.head.appendChild(style)
      const initialIds = workspacesFallback.getSnapshot()?.archivedSessionIds
      style.textContent = buildCss(Array.isArray(initialIds) ? initialIds : [])
      ctx.effect(() => () => style.remove(), 'archive-purge: styles')

      // --- Persisted sidebar filter: force the shipped default ---------------
      if (resetArchivedFilter() !== undefined) {
        // The shipped view store may hydrate after this plugin loads; one
        // deferred pass covers that ordering without fighting a later choice.
        ctx.effect(() => {
          const handle = window.setTimeout(() => {
            resetArchivedFilter()
          }, 2500)
          return () => window.clearTimeout(handle)
        }, 'archive-purge: archived-filter reset')
      }

      const runDelete = async (ids) => {
        const response = await fetch(`${API}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      }

      const Page = createManagerPage(ctx, t, (rows, confirm) => {
        if (rows.length === 0) return
        deleteSignal.set({ rows, confirm })
      }, localeSource, workspacesFallback, sessionsFallback, hidden)
      const Dialog = createDeleteDialog(deleteSignal, t, runDelete)
      const StyleGuard = createStyleGuard(style, workspacesFallback, ghostSignal, deletedSignal)

      ctx.effect(() => ctx.locale.register(NS, DICT), 'archive-purge: dictionaries')

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'archive-purge.hide-archived',
        order: 30,
        locale: NS,
      }, StyleGuard))

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      }, Page))

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 10,
        label: () => t('panel'),
        locale: NS,
      }, ArchivePanelIcon))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'archive-purge.confirm',
        order: 40,
        label: () => t('delete'),
        locale: NS,
      }, Dialog))
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})
