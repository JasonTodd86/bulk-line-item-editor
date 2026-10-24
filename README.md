# Bulk Line Item Editor

A Lightning Web Component for Opportunity record pages. It lists every Opportunity Product (`OpportunityLineItem`) in an inline-editable table, so a user can change several lines and save them all with one click.

## Features

- `lightning-datatable` with Product Name (read-only), Quantity, Sales Price, Discount, Service Date and Line Description (all editable)
- One **Save** button sends all edited rows in a single Apex call; **Cancel** discards edits
- **Partial success**: valid rows are saved, invalid rows show row-level errors and keep the user's edits
- Success / warning / error toasts
- Refreshes the table (`refreshApex`) and the Opportunity's Amount (`notifyRecordUpdateAvailable`) after saving
- Empty state and loading spinner (fetch and save)
- Security: `with sharing`, `WITH USER_MODE` queries, `AccessLevel.USER_MODE` DML (CRUD/FLS enforced), bulk-safe (no SOQL/DML in loops), and only the five editable fields can be written

## Project structure

```
force-app/main/default/
├── classes/
│   ├── BulkLineItemEditorController.cls
│   └── BulkLineItemEditorControllerTest.cls
├── lwc/bulkLineItemEditor/
│   ├── bulkLineItemEditor.html / .js / .css / .js-meta.xml
│   └── __tests__/bulkLineItemEditor.test.js
├── objects/OpportunityLineItem/fields/Discount__c.field-meta.xml
└── permissionsets/Bulk_Line_Item_Editor_Access.permissionset-meta.xml
```

## Deployment (sf CLI)

Prerequisites: [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) and Node.js 18+.

```bash
# 1. Authorize your org (Developer Edition works) and make it the default
sf org login web --alias my-dev-org --set-default

# 2. Deploy
sf project deploy start --source-dir force-app

# 3. Give yourself access to the Discount__c field and the Apex controller
sf org assign permset --name Bulk_Line_Item_Editor_Access

# 4. Run the Apex tests with coverage (they fail until step 3 is done)
sf apex run test --class-names BulkLineItemEditorControllerTest \
  --code-coverage --result-format human --wait 10

# 5. (Optional) Run the Jest tests locally
npm install
npm test
```

## Add it to the Opportunity page

1. Open any Opportunity record.
2. Click the gear icon, then **Edit Page** to open Lightning App Builder.
3. In the **Components** panel, find **Bulk Line Item Editor** (under *Custom*).
4. Drag it onto the page, for example into the main column below the Details tab.
5. Click **Save**, then **Activate** (choose *Assign as Org Default* or an App/Profile assignment), then go back to the record.

Users need Read and Edit access to Opportunity Products and to the edited fields. Assign them the `Bulk Line Item Editor Access` permission set, which grants the `Discount__c` field and the Apex controller.

## Notes

- Discount is shown as a percentage number (10 means 10%).
- Sales Price is a standard Opportunity Product field. Discount is the custom `Discount__c` percent field, because the standard Discount field is not enabled in every org. Assign the `Bulk Line Item Editor Access` permission set to users; if field-level security hides either field from a user, the save for that user returns a row error instead of writing.
