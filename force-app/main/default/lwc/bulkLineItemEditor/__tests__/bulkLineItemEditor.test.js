import { createElement } from 'lwc';
import BulkLineItemEditor from 'c/bulkLineItemEditor';
import getLineItems from '@salesforce/apex/BulkLineItemEditorController.getLineItems';
import updateLineItems from '@salesforce/apex/BulkLineItemEditorController.updateLineItems';
import { refreshApex } from '@salesforce/apex';
import { notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';

// The wire adapter lets the test push data into the component with .emit().
jest.mock(
    '@salesforce/apex/BulkLineItemEditorController.getLineItems',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/BulkLineItemEditorController.updateLineItems',
    () => ({ default: jest.fn() }),
    { virtual: true }
);
jest.mock('@salesforce/apex', () => ({ refreshApex: jest.fn(() => Promise.resolve()) }), {
    virtual: true
});
jest.mock(
    'lightning/uiRecordApi',
    () => ({ notifyRecordUpdateAvailable: jest.fn(() => Promise.resolve()) }),
    { virtual: true }
);

const LINE_ITEMS = [
    { Id: '00k000000000001', Quantity: 1, UnitPrice: 100, Product2: { Name: 'Widget' } },
    { Id: '00k000000000002', Quantity: 2, UnitPrice: 50, Product2: { Name: 'Gadget' } }
];

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

function createComponent() {
    const element = createElement('c-bulk-line-item-editor', { is: BulkLineItemEditor });
    element.recordId = '006000000000001';
    document.body.appendChild(element);
    return element;
}

const query = (element, selector) => element.shadowRoot.querySelector(selector);

/** Simulates the user editing one cell. */
function editCell(element, change) {
    query(element, 'lightning-datatable').dispatchEvent(
        new CustomEvent('cellchange', { detail: { draftValues: [change] } })
    );
}

describe('c-bulk-line-item-editor', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('renders a datatable with flattened product names', async () => {
        const element = createComponent();
        getLineItems.emit(LINE_ITEMS);
        await flushPromises();

        const table = query(element, 'lightning-datatable');
        expect(table).not.toBeNull();
        expect(table.data.map((row) => row.ProductName)).toEqual(['Widget', 'Gadget']);
        expect(query(element, 'lightning-spinner')).toBeNull();
        // Product is read-only, every other column is editable.
        const editable = table.columns.filter((c) => c.editable).map((c) => c.fieldName);
        expect(editable).toEqual(['Quantity', 'UnitPrice', 'Discount__c', 'ServiceDate', 'Description']);
    });

    it('shows the empty state when there are no line items', async () => {
        const element = createComponent();
        getLineItems.emit([]);
        await flushPromises();

        expect(query(element, 'lightning-datatable')).toBeNull();
        expect(element.shadowRoot.textContent).toContain('No products have been added');
    });

    it('saves edited rows, refreshes data and shows a success toast', async () => {
        updateLineItems.mockResolvedValue([
            { recordId: LINE_ITEMS[0].Id, success: true, messages: [], fieldNames: [] }
        ]);
        const element = createComponent();
        const toastHandler = jest.fn();
        element.addEventListener('lightning__showtoast', toastHandler);
        getLineItems.emit(LINE_ITEMS);
        await flushPromises();

        editCell(element, { Id: LINE_ITEMS[0].Id, Quantity: '5' });
        await flushPromises();
        query(element, '[data-id="save"]').click();
        await flushPromises();

        // Strings from the grid are converted to numbers before the Apex call.
        expect(updateLineItems).toHaveBeenCalledWith({
            lineItems: [{ Id: LINE_ITEMS[0].Id, Quantity: 5 }]
        });
        expect(notifyRecordUpdateAvailable).toHaveBeenCalledWith([{ recordId: '006000000000001' }]);
        expect(refreshApex).toHaveBeenCalled();
        expect(toastHandler.mock.calls[0][0].detail.variant).toBe('success');
        expect(query(element, 'lightning-datatable').draftValues).toEqual([]);
    });

    it('keeps failed rows with row-level errors on partial success', async () => {
        updateLineItems.mockResolvedValue([
            { recordId: LINE_ITEMS[0].Id, success: true, messages: [], fieldNames: [] },
            { recordId: LINE_ITEMS[1].Id, success: false, messages: ['Too long'], fieldNames: ['Description'] }
        ]);
        const element = createComponent();
        const toastHandler = jest.fn();
        element.addEventListener('lightning__showtoast', toastHandler);
        getLineItems.emit(LINE_ITEMS);
        await flushPromises();

        editCell(element, { Id: LINE_ITEMS[0].Id, Quantity: '5' });
        editCell(element, { Id: LINE_ITEMS[1].Id, Description: 'bad' });
        await flushPromises();
        query(element, '[data-id="save"]').click();
        await flushPromises();

        const table = query(element, 'lightning-datatable');
        expect(table.errors.rows[LINE_ITEMS[1].Id].messages).toEqual(['Too long']);
        expect(table.draftValues).toEqual([{ Id: LINE_ITEMS[1].Id, Description: 'bad' }]);
        expect(refreshApex).toHaveBeenCalled(); // one row did save
        expect(toastHandler.mock.calls[0][0].detail.variant).toBe('warning');
    });

    it('discards edits when Cancel is clicked', async () => {
        const element = createComponent();
        getLineItems.emit(LINE_ITEMS);
        await flushPromises();

        editCell(element, { Id: LINE_ITEMS[0].Id, Quantity: '9' });
        await flushPromises();
        expect(query(element, 'lightning-datatable').draftValues).toHaveLength(1);

        query(element, '[data-id="cancel"]').click();
        await flushPromises();

        expect(query(element, 'lightning-datatable').draftValues).toEqual([]);
        expect(updateLineItems).not.toHaveBeenCalled();
    });

    it('drops edits for rows that disappear after a reload', async () => {
        const element = createComponent();
        getLineItems.emit(LINE_ITEMS);
        await flushPromises();

        editCell(element, { Id: LINE_ITEMS[0].Id, Quantity: '9' });
        editCell(element, { Id: LINE_ITEMS[1].Id, Quantity: '7' });
        await flushPromises();

        getLineItems.emit([LINE_ITEMS[1]]);
        await flushPromises();

        expect(query(element, 'lightning-datatable').draftValues).toEqual([
            { Id: LINE_ITEMS[1].Id, Quantity: '7' }
        ]);
    });
});
