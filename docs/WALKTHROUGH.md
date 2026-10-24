# How it works: a plain-English walkthrough

## The big picture

The user opens an Opportunity. The component asks Apex for the line items, shows them in an editable grid, collects edits locally, and on **Save** sends all edited rows to Apex in one call. Apex tries to save every row, reports success or failure for each, and the component displays that per-row outcome.

## Loading data

- `@wire(getLineItems, { opportunityId: '$recordId' })` runs when the page gives the component its `recordId`. The `$` makes the wire reactive.
- **Why `cacheable=true`?** Wire requires it, and it makes repeat views fast. The trade-off is that after saving, the cache is stale, which is why we call `refreshApex`.
- **Why flatten `Product2.Name`?** `lightning-datatable` reads only top-level fields, so the JS copies the name into a `ProductName` property.
- The SOQL uses `WITH USER_MODE`, so the user only sees rows and fields they are allowed to see. The class is `with sharing`; user mode covers sharing, CRUD and FLS together.

## Editing

- Columns marked `editable: true` give inline editing. Product is not editable.
- I hid the built-in save bar (`suppress-bottom-bar`) and added my own Save/Cancel buttons in the card footer. This lets me disable them while saving, and put them where the card layout expects them. Because the bar is hidden, I keep the edits myself by listening to `cellchange` and merging changes per row Id into `draftValues`.
- Discount is a percent *number* in Salesforce (10 = 10%), whereas the datatable `percent` type expects 0.1, so I use a plain number column to avoid a silent 100x mistake.

## Saving

1. Drafts arrive from the grid as strings, so `toLineItem` converts Quantity, Sales Price and Discount to numbers, and turns empty strings into `null` (a cleared cell).
2. One Apex call carries all rows: `updateLineItems(lineItems)`. One call keeps latency low and uses one DML statement against governor limits.
3. In Apex, `sanitize` copies only the five allowed fields (and only those actually sent) into a fresh record. This is defense in depth: someone calling the method directly cannot change `OpportunityId` or other fields. Sending `null` is preserved so clearing a cell works.
4. `Database.update(records, false, AccessLevel.USER_MODE)`:
   - `false` = **allOrNone off**, so one bad row does not roll back the good ones (partial success);
   - `USER_MODE` = the running user's CRUD/FLS apply to the write.
5. Results come back in the same order as the input, so I map each `SaveResult` to a `RowResult` (record Id, success flag, messages, field names). Rows with no Id never go to the database; they get an error directly. There are no SOQL or DML statements inside loops, only one query and one DML statement.

## Showing the outcome

- The `RowResult`s become the datatable `errors` object: `{ rows: { [recordId]: { title, messages, fieldNames } } }`. The grid shows an error icon on the row and highlights the cells listed in `fieldNames`.
- Only failed rows stay in `draftValues`, so the user's bad edit is still there to fix. Successful rows drop out of the drafts.
- Toast variant: all saved = success; some saved = warning; none saved = error.

## Refreshing

- `notifyRecordUpdateAvailable([{ recordId }])` tells Lightning Data Service that the Opportunity changed on the server (its **Amount** is rolled up from line items), so the standard Highlights panel and Details refresh without a page reload.
- `refreshApex(wiredResult)` re-runs our own wire so the grid shows the saved values. I only call both when at least one row saved.
- `isSaving` keeps the spinner up until all of this finishes.

## Testing

- **Apex**: all data is created in the test (custom Pricebook, Products, standard and custom PricebookEntries, Opportunities, line items). Cases: fetch, empty fetch, all-valid save, partial failure (a 300-character Description fails the 255-character limit), null/empty list, missing Id, and non-editable fields being ignored.
- **Jest**: render and column setup, empty state, save (number conversion, refresh calls, toast, drafts cleared), partial failure (row errors and remaining drafts), and cancel. Apex and platform modules are mocked.

## Likely interview questions

- *Why not `updateRecord` / `lightning-record-edit-form` per row?* They are one request per record; this does one server call and gives per-row error control.
- *Why `with sharing` and `USER_MODE`?* `with sharing` alone does not enforce FLS/CRUD; `USER_MODE` does.
- *Why return a custom wrapper instead of `SaveResult`?* `SaveResult` is not `@AuraEnabled`, and it lacks the record Id for failed rows reliably; the wrapper gives the UI exactly what it needs.
- *What would you add next?* Delete/add rows, a multi-currency display, and a custom-labels pass for translation.
