import { DataGrid, type GridConfig, type RowDragHandleContext, type RowDragDropConfig } from '@toolbox-web/grid-react';
import type { DataGridElement } from '@toolbox-web/grid';
import '@toolbox-web/grid-react/features/row-drag-drop';
import '@toolbox-web/grid-react/features/selection';
import '@toolbox-web/grid-react/features/editing';
import '@toolbox-web/grid-react/features/cell-entry';
import { createContext, useContext, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

interface Row {
  id: string;
  name: string;
}
const Theme = createContext('missing');
const rows = Array.from({ length: 200 }, (_, index) => ({ id: String(index), name: `Task ${index}` }));
const columns: GridConfig<Row>['columns'] = [{ field: 'name', editable: true }];
const live = new Set<HTMLElement>();
let root: Root;
let allowed = true;
let cancelNative = false;
let rowMode = false;
let prefix = 'main';
let surface: 'props' | 'config' = 'props';
let outputKind: 'jsx' | 'html' | 'view' = 'jsx';
let bindingEnabled = true;
const canDrag = () => allowed;
function Handle({ context, version, bound }: { context: RowDragHandleContext<Row>; version: string; bound: boolean }) {
  const theme = useContext(Theme);
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    live.add(context.host);
    return () => {
      live.delete(context.host);
    };
  }, [context.host]);
  return (
    <button
      ref={bound ? context.bindHandle : undefined}
      data-bound={bound}
      data-drag={context.row.id}
      data-theme={theme}
      data-version={version}
      data-clicks={clicks}
      type="button"
      aria-label={context.ariaLabel}
      aria-disabled={context.disabled}
      onClick={(event) => {
        if (cancelNative) event.preventDefault();
        else setClicks((count) => count + 1);
      }}
      onKeyDown={(event) => {
        if (cancelNative) event.preventDefault();
      }}
      onDragStart={(event) => {
        if (cancelNative) event.preventDefault();
      }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M3 4H15M3 9H15M3 14H15" stroke="currentColor" strokeWidth="3" />
      </svg>
    </button>
  );
}
function renderHandle(context: RowDragHandleContext<Row>, version: string) {
  if (outputKind === 'jsx') return <Handle context={context} version={version} bound={bindingEnabled} />;
  const element = document.createElement('button');
  element.dataset['drag'] = context.row.id;
  element.dataset['output'] = outputKind;
  element.textContent = '::';
  context.bindHandle(element);
  if (outputKind === 'html') return element;
  return {
    element,
    update(next: RowDragHandleContext<Row>) {
      element.setAttribute('aria-disabled', String(next.disabled));
    },
  };
}
export function render(version = 'A', sortable = false) {
  const drag: RowDragDropConfig<Row> = {
    animation: false,
    debounceMs: 0,
    dropZone: 'drag-controls',
    canDrag,
    dragHandleRenderer: (context) => renderHandle(context, version),
  };
  root.render(
    <>
      {['one', 'two'].map((theme) => (
        <Theme.Provider key={theme} value={theme}>
          <DataGrid<Row>
            ref={(api) => {
              if (api?.element) api.element.id = `${prefix}-${theme}`;
            }}
            rows={rows}
            style={{ height: 230, width: 400, display: 'inline-block' }}
            sortable={sortable}
            {...(surface === 'props'
              ? { gridConfig: { columns }, rowDragDrop: drag }
              : { gridConfig: { columns, features: { rowDragDrop: drag } } })}
            selection={rowMode ? 'row' : 'range'}
            editing={{ editOn: 'manual' }}
            cellEntry={rowMode ? false : { singleClick: true }}
          />
        </Theme.Provider>
      ))}
    </>,
  );
}
export function mount(
  selectedRows = false,
  idPrefix = 'main',
  featureSurface: 'props' | 'config' = 'props',
  initialOutput: 'jsx' | 'html' = 'jsx',
) {
  rowMode = selectedRows;
  prefix = idPrefix;
  surface = featureSurface;
  outputKind = initialOutput;
  bindingEnabled = true;
  const container = document.createElement('div');
  container.id = 'drag-react-fixture';
  document.body.append(container);
  root = createRoot(container);
  render();
}
export function setOutput(kind: typeof outputKind) {
  outputKind = kind;
  document
    .querySelectorAll<DataGridElement>('#drag-react-fixture tbw-grid')
    .forEach((grid) => grid.getPluginByName('rowDragDrop')?.afterRender());
}
export function setBinding(enabled: boolean) {
  bindingEnabled = enabled;
  setOutput(outputKind);
}
export function policy(enabled: boolean, cancel = false) {
  allowed = enabled;
  cancelNative = cancel;
}
export function unmount() {
  root.unmount();
}
export function liveCount() {
  return live.size;
}
