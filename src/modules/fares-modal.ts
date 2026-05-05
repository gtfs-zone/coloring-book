import { showModal } from './modal-utils.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
import {
  generateFieldConfigsFromSchema,
  renderFieldLabelContent,
  renderFormFields,
  type FieldConfig,
} from '../utils/field-component.js';
import { GTFSSchemas, GTFS_TABLES } from '../types/gtfs.js';
import type { z } from 'zod';

export interface FaresModalDeps {
  gtfsDatabase: {
    getAllRows: (tableName: string) => Promise<Record<string, unknown>[]>;
    insertRows: (
      tableName: string,
      rows: Record<string, unknown>[]
    ) => Promise<void>;
    updateRow: (
      tableName: string,
      key: string,
      data: Record<string, unknown>
    ) => Promise<void>;
    deleteRow: (tableName: string, key: string) => Promise<void>;
  };
  patchManager: {
    recordInsert: (
      table: string,
      id: string,
      record: Record<string, unknown>
    ) => Promise<void>;
    recordUpdate: (
      table: string,
      id: string,
      before: Record<string, unknown>,
      after: Record<string, unknown>
    ) => Promise<void>;
    recordDelete: (
      table: string,
      id: string,
      record: Record<string, unknown>
    ) => Promise<void>;
  };
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readFormValues(
  container: HTMLElement,
  fields: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const el = container.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[data-field="${field}"]`
    );
    result[field] = el ? el.value.trim() : '';
  }
  return result;
}

function showFormError(errorEl: HTMLElement | null, msg: string): void {
  if (!errorEl) {
    return;
  }
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function renderColumnHeader(fieldName: string, configs: FieldConfig[]): string {
  const config = configs.find((c) => c.field === fieldName);
  return config
    ? `<th>${renderFieldLabelContent(config, 'bottom')}</th>`
    : `<th>${fieldName}</th>`;
}

function renderRiderCategoriesPanel(rows: Record<string, unknown>[]): string {
  const configs = generateFieldConfigsFromSchema(
    GTFSSchemas[GTFS_TABLES.RIDER_CATEGORIES] as Parameters<
      typeof generateFieldConfigsFromSchema
    >[0],
    {},
    GTFS_TABLES.RIDER_CATEGORIES
  );
  const rowsHtml =
    rows.length === 0
      ? `<tr><td colspan="4" class="text-center text-base-content/60 py-4">No rider categories yet.</td></tr>`
      : rows
          .map(
            (r) => `
          <tr>
            <td class="font-mono text-xs">${esc(r.rider_category_id)}</td>
            <td>${esc(r.rider_category_name)}</td>
            <td>${Number(r.is_default_fare_container) === 1 ? 'Yes' : '—'}</td>
            <td>
              <div class="flex gap-1">
                <button class="btn btn-xs btn-ghost" data-action="edit" data-key="${esc(r.rider_category_id)}">Edit</button>
                <button class="btn btn-xs btn-ghost text-error" data-action="delete" data-key="${esc(r.rider_category_id)}">Delete</button>
              </div>
            </td>
          </tr>
        `
          )
          .join('');

  return `
    <div>
      <div class="flex justify-end mb-2">
        <button class="btn btn-sm btn-primary" data-action="add">+ Add</button>
      </div>
      <div class="overflow-x-auto">
        <table class="table table-xs">
          <thead>
            <tr>${renderColumnHeader('rider_category_id', configs)}${renderColumnHeader('rider_category_name', configs)}${renderColumnHeader('is_default_fare_container', configs)}<th></th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

const FARE_MEDIA_TYPE_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Paper ticket',
  2: 'Transit card',
  3: 'cEMV',
  4: 'Mobile app',
};

function renderFareMediaPanel(rows: Record<string, unknown>[]): string {
  const configs = generateFieldConfigsFromSchema(
    GTFSSchemas[GTFS_TABLES.FARE_MEDIA] as Parameters<
      typeof generateFieldConfigsFromSchema
    >[0],
    {},
    GTFS_TABLES.FARE_MEDIA
  );
  const rowsHtml =
    rows.length === 0
      ? `<tr><td colspan="4" class="text-center text-base-content/60 py-4">No fare media yet.</td></tr>`
      : rows
          .map(
            (r) => `
          <tr>
            <td class="font-mono text-xs">${esc(r.fare_media_id)}</td>
            <td>${esc(r.fare_media_name)}</td>
            <td>${esc(FARE_MEDIA_TYPE_LABELS[Number(r.fare_media_type)] ?? r.fare_media_type)}</td>
            <td>
              <div class="flex gap-1">
                <button class="btn btn-xs btn-ghost" data-action="edit" data-key="${esc(r.fare_media_id)}">Edit</button>
                <button class="btn btn-xs btn-ghost text-error" data-action="delete" data-key="${esc(r.fare_media_id)}">Delete</button>
              </div>
            </td>
          </tr>
        `
          )
          .join('');

  return `
    <div>
      <div class="flex justify-end mb-2">
        <button class="btn btn-sm btn-primary" data-action="add">+ Add</button>
      </div>
      <div class="overflow-x-auto">
        <table class="table table-xs">
          <thead>
            <tr>${renderColumnHeader('fare_media_id', configs)}${renderColumnHeader('fare_media_name', configs)}${renderColumnHeader('fare_media_type', configs)}<th></th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderFareProductsPanel(
  rows: Record<string, unknown>[],
  riderCats: Record<string, unknown>[],
  fareMedia: Record<string, unknown>[]
): string {
  const configs = generateFieldConfigsFromSchema(
    GTFSSchemas[GTFS_TABLES.FARE_PRODUCTS] as Parameters<
      typeof generateFieldConfigsFromSchema
    >[0],
    {},
    GTFS_TABLES.FARE_PRODUCTS
  );
  const riderCatNames = new Map(
    riderCats.map((r) => [
      String(r.rider_category_id),
      String(r.rider_category_name ?? r.rider_category_id),
    ])
  );
  const fareMediaNames = new Map(
    fareMedia.map((r) => [
      String(r.fare_media_id),
      String(r.fare_media_name ?? r.fare_media_id),
    ])
  );

  const rowsHtml =
    rows.length === 0
      ? `<tr><td colspan="7" class="text-center text-base-content/60 py-4">No fare products yet.</td></tr>`
      : rows
          .map((r) => {
            const key = generateCompositeKeyFromRecord('fare_products', r);
            const riderCatDisplay = r.rider_category_id
              ? (riderCatNames.get(String(r.rider_category_id)) ??
                String(r.rider_category_id))
              : '—';
            const fareMediaDisplay = r.fare_media_id
              ? (fareMediaNames.get(String(r.fare_media_id)) ??
                String(r.fare_media_id))
              : '—';
            return `
            <tr>
              <td class="font-mono text-xs">${esc(r.fare_product_id)}</td>
              <td>${esc(r.fare_product_name)}</td>
              <td>${esc(riderCatDisplay)}</td>
              <td>${esc(fareMediaDisplay)}</td>
              <td>${esc(r.amount)}</td>
              <td>${esc(r.currency)}</td>
              <td>
                <div class="flex gap-1">
                  <button class="btn btn-xs btn-ghost" data-action="edit" data-key="${esc(key)}">Edit</button>
                  <button class="btn btn-xs btn-ghost text-error" data-action="delete" data-key="${esc(key)}">Delete</button>
                </div>
              </td>
            </tr>
          `;
          })
          .join('');

  return `
    <div>
      <div class="flex justify-end mb-2">
        <button class="btn btn-sm btn-primary" data-action="add">+ Add</button>
      </div>
      <div class="overflow-x-auto">
        <table class="table table-xs">
          <thead>
            <tr>${renderColumnHeader('fare_product_id', configs)}${renderColumnHeader('fare_product_name', configs)}${renderColumnHeader('rider_category_id', configs)}${renderColumnHeader('fare_media_id', configs)}${renderColumnHeader('amount', configs)}${renderColumnHeader('currency', configs)}<th></th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function showAddEditRiderCategoryModal(
  existing: Record<string, unknown> | null,
  deps: FaresModalDeps
): Promise<void> {
  const isEdit = existing !== null;
  const recordId = isEdit ? String(existing!.rider_category_id) : undefined;

  const schema = GTFSSchemas[
    GTFS_TABLES.RIDER_CATEGORIES
  ] as z.ZodObject<z.ZodRawShape>;
  const configs: FieldConfig[] = generateFieldConfigsFromSchema(
    schema,
    (existing as Record<string, string | number | undefined>) ?? {},
    GTFS_TABLES.RIDER_CATEGORIES
  )
    .map((c) => ({ ...c, recordId }))
    .map((c) =>
      c.field === 'rider_category_id' ? { ...c, readonly: isEdit } : c
    );

  const formHtml = `
    <div id="fares-rc-form">
      <div id="fares-rc-error" class="alert alert-error text-sm hidden"></div>
      ${renderFormFields(configs)}
    </div>
  `;

  let errorEl: HTMLElement | null = null;

  await showModal({
    title: isEdit ? 'Edit Rider Category' : 'Add Rider Category',
    body: formHtml,
    actions: [
      {
        label: 'Save',
        className: 'btn-primary',
        onClick: async () => {
          const form = document.getElementById('fares-rc-form');
          if (!form) {
            return;
          }
          const vals = readFormValues(form, [
            'rider_category_id',
            'rider_category_name',
            'is_default_fare_container',
            'eligibility_url',
            'min_age',
            'max_age',
          ]);
          if (!isEdit && !vals.rider_category_id) {
            showFormError(errorEl, 'Rider Category ID is required');
            return true;
          }
          if (!vals.rider_category_name) {
            showFormError(errorEl, 'Name is required');
            return true;
          }
          const id = isEdit
            ? String(existing!.rider_category_id)
            : vals.rider_category_id;
          const record: Record<string, unknown> = {
            rider_category_id: id,
            rider_category_name: vals.rider_category_name,
          };
          if (vals.is_default_fare_container !== '') {
            record.is_default_fare_container = Number(
              vals.is_default_fare_container
            );
          }
          if (vals.eligibility_url) {
            record.eligibility_url = vals.eligibility_url;
          }
          if (vals.min_age !== '') {
            record.min_age = Number(vals.min_age);
          }
          if (vals.max_age !== '') {
            record.max_age = Number(vals.max_age);
          }

          if (isEdit) {
            await deps.patchManager.recordUpdate(
              'rider_categories',
              id,
              existing!,
              record
            );
          } else {
            await deps.gtfsDatabase.insertRows('rider_categories', [record]);
            await deps.patchManager.recordInsert(
              'rider_categories',
              id,
              record
            );
          }
          console.log(
            `[FaresModal] ${isEdit ? 'Updated' : 'Created'} rider_category ${id}`
          );
          return;
        },
      },
      { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
    ],
    escapeAction: 1,
    enterAction: 0,
    onMount: (_close) => {
      errorEl = document.getElementById('fares-rc-error');
    },
  });
}

async function showAddEditFareMediaModal(
  existing: Record<string, unknown> | null,
  deps: FaresModalDeps
): Promise<void> {
  const isEdit = existing !== null;
  const recordId = isEdit ? String(existing!.fare_media_id) : undefined;

  const schema = GTFSSchemas[
    GTFS_TABLES.FARE_MEDIA
  ] as z.ZodObject<z.ZodRawShape>;
  const configs: FieldConfig[] = generateFieldConfigsFromSchema(
    schema,
    (existing as Record<string, string | number | undefined>) ?? {},
    GTFS_TABLES.FARE_MEDIA
  )
    .map((c) => ({ ...c, recordId }))
    .map((c) => (c.field === 'fare_media_id' ? { ...c, readonly: isEdit } : c));

  const formHtml = `
    <div id="fares-fm-form">
      <div id="fares-fm-error" class="alert alert-error text-sm hidden"></div>
      ${renderFormFields(configs)}
    </div>
  `;

  let errorEl: HTMLElement | null = null;

  await showModal({
    title: isEdit ? 'Edit Fare Media' : 'Add Fare Media',
    body: formHtml,
    actions: [
      {
        label: 'Save',
        className: 'btn-primary',
        onClick: async () => {
          const form = document.getElementById('fares-fm-form');
          if (!form) {
            return;
          }
          const vals = readFormValues(form, [
            'fare_media_id',
            'fare_media_name',
            'fare_media_type',
          ]);
          if (!isEdit && !vals.fare_media_id) {
            showFormError(errorEl, 'Fare Media ID is required');
            return true;
          }
          if (vals.fare_media_type === '') {
            showFormError(errorEl, 'Type is required');
            return true;
          }
          const id = isEdit
            ? String(existing!.fare_media_id)
            : vals.fare_media_id;
          const record: Record<string, unknown> = {
            fare_media_id: id,
            fare_media_type: Number(vals.fare_media_type),
          };
          if (vals.fare_media_name) {
            record.fare_media_name = vals.fare_media_name;
          }

          if (isEdit) {
            await deps.patchManager.recordUpdate(
              'fare_media',
              id,
              existing!,
              record
            );
          } else {
            await deps.gtfsDatabase.insertRows('fare_media', [record]);
            await deps.patchManager.recordInsert('fare_media', id, record);
          }
          console.log(
            `[FaresModal] ${isEdit ? 'Updated' : 'Created'} fare_media ${id}`
          );
          return;
        },
      },
      { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
    ],
    escapeAction: 1,
    enterAction: 0,
    onMount: (_close) => {
      errorEl = document.getElementById('fares-fm-error');
    },
  });
}

async function showAddEditFareProductModal(
  existing: Record<string, unknown> | null,
  deps: FaresModalDeps,
  riderCats: Record<string, unknown>[],
  fareMedia: Record<string, unknown>[]
): Promise<void> {
  const isEdit = existing !== null;
  const recordId = isEdit
    ? generateCompositeKeyFromRecord(
        'fare_products',
        existing as Record<string, unknown>
      )
    : undefined;

  const schema = GTFSSchemas[
    GTFS_TABLES.FARE_PRODUCTS
  ] as z.ZodObject<z.ZodRawShape>;
  const baseConfigs = generateFieldConfigsFromSchema(
    schema,
    (existing as Record<string, string | number | undefined>) ?? {},
    GTFS_TABLES.FARE_PRODUCTS
  )
    .map((c) => ({ ...c, recordId }))
    .map((c) =>
      c.field === 'fare_product_id' ? { ...c, readonly: isEdit } : c
    );

  const riderCatSelectOptions = [
    { value: '', label: '— All riders —' },
    ...riderCats.map((r) => ({
      value: String(r.rider_category_id),
      label: String(r.rider_category_name ?? r.rider_category_id),
    })),
  ];
  const fareMediaSelectOptions = [
    { value: '', label: '— Unknown media —' },
    ...fareMedia.map((r) => ({
      value: String(r.fare_media_id),
      label: String(r.fare_media_name ?? r.fare_media_id),
    })),
  ];

  const configs: FieldConfig[] = baseConfigs.map((c) => {
    if (c.field === 'rider_category_id') {
      return {
        ...c,
        type: 'select',
        options: riderCatSelectOptions,
        readonly: isEdit,
      };
    }
    if (c.field === 'fare_media_id') {
      return {
        ...c,
        type: 'select',
        options: fareMediaSelectOptions,
        readonly: isEdit,
      };
    }
    return c;
  });

  const formHtml = `
    <div id="fares-fp-form">
      <div id="fares-fp-error" class="alert alert-error text-sm hidden"></div>
      ${renderFormFields(configs)}
    </div>
  `;

  let errorEl: HTMLElement | null = null;

  await showModal({
    title: isEdit ? 'Edit Fare Product' : 'Add Fare Product',
    body: formHtml,
    actions: [
      {
        label: 'Save',
        className: 'btn-primary',
        onClick: async () => {
          const form = document.getElementById('fares-fp-form');
          if (!form) {
            return;
          }
          const vals = readFormValues(form, [
            'fare_product_id',
            'fare_product_name',
            'rider_category_id',
            'fare_media_id',
            'amount',
            'currency',
          ]);
          if (!isEdit && !vals.fare_product_id) {
            showFormError(errorEl, 'Fare Product ID is required');
            return true;
          }
          if (vals.amount === '') {
            showFormError(errorEl, 'Amount is required');
            return true;
          }
          if (isNaN(Number(vals.amount))) {
            showFormError(errorEl, 'Amount must be a number');
            return true;
          }
          if (!vals.currency) {
            showFormError(errorEl, 'Currency is required');
            return true;
          }
          const fareProductId = isEdit
            ? String(existing!.fare_product_id)
            : vals.fare_product_id;
          const record: Record<string, unknown> = {
            fare_product_id: fareProductId,
            amount: Number(vals.amount),
            currency: vals.currency.toUpperCase(),
          };
          if (vals.fare_product_name) {
            record.fare_product_name = vals.fare_product_name;
          }
          if (isEdit) {
            if (existing!.rider_category_id) {
              record.rider_category_id = existing!.rider_category_id;
            }
            if (existing!.fare_media_id) {
              record.fare_media_id = existing!.fare_media_id;
            }
          } else {
            if (vals.rider_category_id) {
              record.rider_category_id = vals.rider_category_id;
            }
            if (vals.fare_media_id) {
              record.fare_media_id = vals.fare_media_id;
            }
          }
          const id = generateCompositeKeyFromRecord('fare_products', record);

          if (isEdit) {
            await deps.patchManager.recordUpdate(
              'fare_products',
              id,
              existing!,
              record
            );
          } else {
            await deps.gtfsDatabase.insertRows('fare_products', [record]);
            await deps.patchManager.recordInsert('fare_products', id, record);
          }
          console.log(
            `[FaresModal] ${isEdit ? 'Updated' : 'Created'} fare_product ${id}`
          );
          return;
        },
      },
      { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
    ],
    escapeAction: 1,
    enterAction: 0,
    onMount: (_close) => {
      errorEl = document.getElementById('fares-fp-error');
    },
  });
}

async function showDeleteConfirmModal(
  tableName: string,
  key: string,
  record: Record<string, unknown>,
  deps: FaresModalDeps
): Promise<void> {
  await showModal({
    title: 'Confirm Delete',
    body: `<p>Are you sure you want to delete this record? This can be undone via Edit → Undo.</p>`,
    actions: [
      {
        label: 'Delete',
        className: 'btn-error',
        onClick: async () => {
          await deps.gtfsDatabase.deleteRow(tableName, key);
          await deps.patchManager.recordDelete(tableName, key, record);
          console.log(`[FaresModal] Deleted ${tableName} ${key}`);
        },
      },
      { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
    ],
    escapeAction: 1,
  });
}

export async function showFaresModal(deps: FaresModalDeps): Promise<void> {
  const initialRows = await deps.gtfsDatabase.getAllRows('rider_categories');

  const body = `
    <div>
      <p class="text-xs text-base-content/60 mb-3">Supports a limited set of Fares V2: rider categories, fare media, and fare products. More tables coming soon. Fares V1 is not shown here — use the file viewer to inspect those tables. <a href="https://gtfs.org/documentation/schedule/reference/#fare_attributestxt" target="_blank" rel="noopener noreferrer" class="link">More info</a>.</p>
      <div class="tabs tabs-border mb-4" id="fares-tabs">
        <button class="tab tab-active" data-tab="rider_categories">Rider Categories</button>
        <button class="tab" data-tab="fare_media">Fare Media</button>
        <button class="tab" data-tab="fare_products">Fare Products</button>
      </div>
      <div id="fares-panel">${renderRiderCategoriesPanel(initialRows)}</div>
    </div>
  `;

  await showModal({
    title: 'Fares',
    body,
    actions: [{ label: 'Close', onClick: () => {} }],
    escapeAction: 0,
    boxClassName: 'max-w-3xl',
    onMount: (_close) => {
      let currentTab = 'rider_categories';

      const panelEl = document.getElementById('fares-panel');
      const tabBtns = document.querySelectorAll<HTMLButtonElement>(
        '#fares-tabs [data-tab]'
      );

      if (!panelEl) {
        return;
      }

      const refreshPanel = async (): Promise<void> => {
        if (currentTab === 'rider_categories') {
          const rows = await deps.gtfsDatabase.getAllRows('rider_categories');
          panelEl.innerHTML = renderRiderCategoriesPanel(rows);
        } else if (currentTab === 'fare_media') {
          const rows = await deps.gtfsDatabase.getAllRows('fare_media');
          panelEl.innerHTML = renderFareMediaPanel(rows);
        } else {
          const [rows, riderCats, fareMedia] = await Promise.all([
            deps.gtfsDatabase.getAllRows('fare_products'),
            deps.gtfsDatabase.getAllRows('rider_categories'),
            deps.gtfsDatabase.getAllRows('fare_media'),
          ]);
          panelEl.innerHTML = renderFareProductsPanel(
            rows,
            riderCats,
            fareMedia
          );
        }
      };

      tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          currentTab = btn.dataset.tab ?? 'rider_categories';
          tabBtns.forEach((b) => b.classList.remove('tab-active'));
          btn.classList.add('tab-active');
          void refreshPanel();
        });
      });

      const handlePanelClick = async (e: MouseEvent): Promise<void> => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
          '[data-action]'
        );
        if (!btn) {
          return;
        }

        const action = btn.dataset.action;
        const key = btn.dataset.key ?? '';

        if (action === 'add') {
          if (currentTab === 'rider_categories') {
            await showAddEditRiderCategoryModal(null, deps);
          } else if (currentTab === 'fare_media') {
            await showAddEditFareMediaModal(null, deps);
          } else {
            const [riderCats, fareMedia] = await Promise.all([
              deps.gtfsDatabase.getAllRows('rider_categories'),
              deps.gtfsDatabase.getAllRows('fare_media'),
            ]);
            await showAddEditFareProductModal(null, deps, riderCats, fareMedia);
          }
          void refreshPanel();
        } else if (action === 'edit' && key) {
          if (currentTab === 'rider_categories') {
            const rows = await deps.gtfsDatabase.getAllRows('rider_categories');
            const record =
              rows.find((r) => String(r.rider_category_id) === key) ?? null;
            if (record) {
              await showAddEditRiderCategoryModal(record, deps);
            }
          } else if (currentTab === 'fare_media') {
            const rows = await deps.gtfsDatabase.getAllRows('fare_media');
            const record =
              rows.find((r) => String(r.fare_media_id) === key) ?? null;
            if (record) {
              await showAddEditFareMediaModal(record, deps);
            }
          } else {
            const [rows, riderCats, fareMedia] = await Promise.all([
              deps.gtfsDatabase.getAllRows('fare_products'),
              deps.gtfsDatabase.getAllRows('rider_categories'),
              deps.gtfsDatabase.getAllRows('fare_media'),
            ]);
            const record =
              rows.find(
                (r) =>
                  generateCompositeKeyFromRecord('fare_products', r) === key
              ) ?? null;
            if (record) {
              await showAddEditFareProductModal(
                record,
                deps,
                riderCats,
                fareMedia
              );
            }
          }
          void refreshPanel();
        } else if (action === 'delete' && key) {
          if (currentTab === 'rider_categories') {
            const rows = await deps.gtfsDatabase.getAllRows('rider_categories');
            const record = rows.find(
              (r) => String(r.rider_category_id) === key
            );
            if (record) {
              await showDeleteConfirmModal(
                'rider_categories',
                key,
                record,
                deps
              );
            }
          } else if (currentTab === 'fare_media') {
            const rows = await deps.gtfsDatabase.getAllRows('fare_media');
            const record = rows.find((r) => String(r.fare_media_id) === key);
            if (record) {
              await showDeleteConfirmModal('fare_media', key, record, deps);
            }
          } else {
            const rows = await deps.gtfsDatabase.getAllRows('fare_products');
            const record = rows.find(
              (r) => generateCompositeKeyFromRecord('fare_products', r) === key
            );
            if (record) {
              await showDeleteConfirmModal('fare_products', key, record, deps);
            }
          }
          void refreshPanel();
        }
      };

      panelEl.addEventListener('click', (e) => void handlePanelClick(e));
    },
  });
}
