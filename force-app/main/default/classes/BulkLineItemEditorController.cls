/**
 * Server-side controller for the bulkLineItemEditor Lightning Web Component.
 *
 * Responsibilities:
 *  1. Fetch the Opportunity Products (OpportunityLineItem) for an Opportunity.
 *  2. Save edits to many line items in one call and report a result PER ROW,
 *     so the UI can show row-level errors while keeping the rows that saved.
 *
 * Security: the class is "with sharing", SOQL uses WITH USER_MODE and DML uses
 * AccessLevel.USER_MODE, so sharing rules, CRUD and field-level security of the
 * running user are all enforced.
 */
public with sharing class BulkLineItemEditorController {

    /**
     * The only fields a user may change through this component. Anything else
     * in an incoming record (for example OpportunityId) is silently dropped
     * so a tampered client request cannot modify other fields.
     */
    private static final Set<String> EDITABLE_FIELDS = new Set<String>{
        'Quantity',
        'UnitPrice',
        'Discount__c',
        'ServiceDate',
        'Description'
    };

    /**
     * Upper bound on rows returned by getLineItems. Salesforce itself caps an
     * Opportunity at 200 products, so this only guards the query.
     */
    private static final Integer MAX_LINE_ITEMS = 200;

    /**
     * Outcome of saving one line item. Returned to the LWC in the same order
     * as the records that were sent in.
     */
    public class RowResult {
        @AuraEnabled public Id recordId;
        @AuraEnabled public Boolean success = true;
        @AuraEnabled public List<String> messages = new List<String>();
        @AuraEnabled public List<String> fieldNames = new List<String>();

        public RowResult(Id recordId) {
            this.recordId = recordId;
        }

        public void addError(String message, List<String> fields) {
            this.success = false;
            this.messages.add(message);
            if (fields != null) {
                this.fieldNames.addAll(fields);
            }
        }
    }

    /**
     * Returns the line items of an Opportunity.
     * Cacheable so the LWC can use it with @wire and refreshApex.
     *
     * @param opportunityId Id of the parent Opportunity
     * @return up to 200 line items, oldest first; empty list when there are none
     */
    @AuraEnabled(cacheable=true)
    public static List<OpportunityLineItem> getLineItems(Id opportunityId) {
        return [
            SELECT Id, OpportunityId, Product2.Name, Quantity, UnitPrice,
                   Discount__c, ServiceDate, Description
            FROM OpportunityLineItem
            WHERE OpportunityId = :opportunityId
            WITH USER_MODE
            ORDER BY CreatedDate, Id
            LIMIT :MAX_LINE_ITEMS
        ];
    }

    /**
     * Updates many line items with a single DML statement (partial success).
     * Rows that fail validation do not block rows that are valid.
     *
     * @param lineItems records containing the Id plus the edited fields
     * @return one RowResult per input record, in the same order
     */
    @AuraEnabled
    public static List<RowResult> updateLineItems(List<OpportunityLineItem> lineItems) {
        List<RowResult> results = new List<RowResult>();
        if (lineItems == null || lineItems.isEmpty()) {
            return results;
        }

        // Records that are actually sent to the database, and where each one
        // lives in "results" so database results can be mapped back.
        List<OpportunityLineItem> toUpdate = new List<OpportunityLineItem>();
        List<Integer> resultIndexes = new List<Integer>();

        for (Integer i = 0; i < lineItems.size(); i++) {
            OpportunityLineItem item = lineItems[i];
            RowResult row = new RowResult(item?.Id);
            results.add(row);

            if (item == null || item.Id == null) {
                row.addError('A line item Id is required to save changes.', null);
                continue;
            }
            toUpdate.add(sanitize(item));
            resultIndexes.add(i);
        }

        if (toUpdate.isEmpty()) {
            return results;
        }

        // allOrNone = false -> partial success. USER_MODE -> CRUD/FLS enforced.
        List<Database.SaveResult> saveResults =
            Database.update(toUpdate, false, AccessLevel.USER_MODE);

        // saveResults is returned in the same order as toUpdate.
        for (Integer i = 0; i < saveResults.size(); i++) {
            if (saveResults[i].isSuccess()) {
                continue;
            }
            RowResult row = results[resultIndexes[i]];
            for (Database.Error err : saveResults[i].getErrors()) {
                row.addError(err.getMessage(), err.getFields());
            }
        }
        return results;
    }

    /**
     * Builds a clean record holding only the Id and the editable fields that
     * were actually sent. A field explicitly sent as null (the user cleared
     * the cell) is kept, so it is saved as blank; a field that was not sent
     * at all is left untouched.
     */
    private static OpportunityLineItem sanitize(OpportunityLineItem source) {
        OpportunityLineItem clean = new OpportunityLineItem(Id = source.Id);
        Map<String, Object> populated = source.getPopulatedFieldsAsMap();
        for (String fieldName : EDITABLE_FIELDS) {
            if (populated.containsKey(fieldName)) {
                clean.put(fieldName, populated.get(fieldName));
            }
        }
        return clean;
    }
}
