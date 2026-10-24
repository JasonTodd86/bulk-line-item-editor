import { LightningElement, api, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import { notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import getLineItems from '@salesforce/apex/BulkLineItemEditorController.getLineItems';
import updateLineItems from '@salesforce/apex/BulkLineItemEditorController.updateLineItems';

// Fields that must be sent to Apex as numbers (the datatable gives strings).
const NUMERIC_FIELDS = ['Quantity', 'UnitPrice', 'Discount__c'];

const COLUMNS = [
    { label: 'Product', fieldName: 'ProductName', type: 'text' },
    {
        label: 'Quantity',
        fieldName: 'Quantity',
        type: 'number',
        editable: true,
        typeAttributes: { minimumFractionDigits: 0, maximumFractionDigits: 2 }
    },
    {
        label: 'Sales Price',
        fieldName: 'UnitPrice',
        type: 'currency',
        editable: true
    },
    {
        // Discount is stored as a percent number (10 = 10%), so it is shown as a plain number.
        label: 'Discount (%)',
        fieldName: 'Discount__c',
        type: 'number',
        editable: true,
        typeAttributes: { minimumFractionDigits: 0, maximumFractionDigits: 2 }
    },
    { label: 'Service Date', fieldName: 'ServiceDate', type: 'date-local', editable: true },
    { label: 'Line Description', fieldName: 'Description', type: 'text', editable: true }
];

/** Turns any Apex / wire / JS error into one readable string. */
function reduceError(error) {
    if (Array.isArray(error?.body)) {
        return error.body.map((e) => e.message).join(', ');
    }
    return error?.body?.message || error?.message || 'Unknown error';
}

/** Flattens Product2.Name because the datatable cannot read nested fields. */
function toRows(lineItems) {
    return lineItems.map((item) => ({ ...item, ProductName: item.Product2?.Name }));
}

/** Converts one datatable draft into the record shape Apex expects. */
function toLineItem(draft) {
    const record = { Id: draft.Id };
    Object.keys(draft)
        .filter((field) => field !== 'Id')
        .forEach((field) => {
            const value = draft[field];
            if (value === '' || value === null || value === undefined) {
                record[field] = null; // cleared cell -> blank in Salesforce
            } else {
                record[field] = NUMERIC_FIELDS.includes(field) ? Number(value) : value;
            }
        });
    return record;
}

export default class BulkLineItemEditor extends LightningElement {
    @api recordId; // Opportunity Id, supplied by the record page

    columns = COLUMNS;
    rows = [];
    draftValues = [];
    errors = {};
    loadError;

    isFetching = true;
    isSaving = false;

    wiredResult; // kept so refreshApex can re-run the wire

    @wire(getLineItems, { opportunityId: '$recordId' })
    wiredLineItems(result) {
        this.wiredResult = result;
        const { data, error } = result;
        if (data) {
            this.rows = toRows(data);
            this.dropStaleEdits();
            this.loadError = undefined;
            this.isFetching = false;
        } else if (error) {
            this.rows = [];
            this.loadError = reduceError(error);
            this.isFetching = false;
        }
    }

    /** After a reload, forget edits and errors for rows that no longer exist. */
    dropStaleEdits() {
        const ids = new Set(this.rows.map((row) => row.Id));
        this.draftValues = this.draftValues.filter((draft) => ids.has(draft.Id));
        if (this.errors.rows) {
            const rowErrors = Object.fromEntries(
                Object.entries(this.errors.rows).filter(([id]) => ids.has(id))
            );
            this.errors = Object.keys(rowErrors).length ? { rows: rowErrors } : {};
        }
    }

    get showSpinner() {
        return this.isFetching || this.isSaving;
    }

    get hasRows() {
        return !this.loadError && this.rows.length > 0;
    }

    get hasNoRows() {
        return !this.isFetching && !this.loadError && this.rows.length === 0;
    }

    get disableActions() {
        return this.isSaving || this.draftValues.length === 0;
    }

    /** Collects edits (one entry per row) because the built-in save bar is hidden. */
    handleCellChange(event) {
        const byId = new Map(this.draftValues.map((draft) => [draft.Id, draft]));
        event.detail.draftValues.forEach((change) => {
            byId.set(change.Id, { ...byId.get(change.Id), ...change });
        });
        this.draftValues = [...byId.values()];
    }

    handleCancel() {
        this.draftValues = [];
        this.errors = {};
    }

    async handleSave() {
        if (this.disableActions) {
            return;
        }
        const drafts = this.draftValues;
        this.isSaving = true;
        this.errors = {};
        try {
            const results = await updateLineItems({ lineItems: drafts.map(toLineItem) });
            await this.handleResults(drafts, results);
        } catch (error) {
            this.toast('Save failed', reduceError(error), 'error');
        } finally {
            this.isSaving = false;
        }
    }

    async handleResults(drafts, results) {
        const failed = results.filter((result) => !result.success);
        const savedCount = results.length - failed.length;

        // Row-level errors, keyed by record Id, in the format lightning-datatable expects.
        const rowErrors = {};
        failed.forEach((result) => {
            rowErrors[result.recordId] = {
                title: "We couldn't save this line item.",
                messages: result.messages,
                fieldNames: result.fieldNames
            };
        });
        this.errors = failed.length ? { rows: rowErrors } : {};
        // Keep the user's edits only for rows that failed so they can fix and retry.
        this.draftValues = drafts.filter((draft) => rowErrors[draft.Id]);

        if (savedCount > 0) {
            // Opportunity Amount is recalculated by Salesforce; tell the page to reload it.
            await notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
            await refreshApex(this.wiredResult);
        }

        if (failed.length === 0) {
            this.toast('Success', `${savedCount} line item(s) saved.`, 'success');
        } else if (savedCount > 0) {
            this.toast(
                'Partially saved',
                `${savedCount} saved, ${failed.length} failed. Fix the highlighted rows and save again.`,
                'warning'
            );
        } else {
            this.toast('Save failed', 'No line items were saved. Check the highlighted rows.', 'error');
        }
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
