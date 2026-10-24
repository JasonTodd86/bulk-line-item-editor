/**
 * Tests for BulkLineItemEditorController.
 * All data is created here; nothing depends on existing org data.
 */
@IsTest
private class BulkLineItemEditorControllerTest {

    /**
     * Builds: custom Pricebook, 3 Products with standard + custom
     * PricebookEntries, one Opportunity with 3 line items and one empty
     * Opportunity.
     */
    @TestSetup
    static void setupData() {
        Id standardPricebookId = Test.getStandardPricebookId();
        Pricebook2 customPricebook = new Pricebook2(Name = 'Test Pricebook', IsActive = true);
        insert customPricebook;

        List<Product2> products = new List<Product2>();
        for (Integer i = 1; i <= 3; i++) {
            products.add(new Product2(Name = 'Test Product ' + i, IsActive = true));
        }
        insert products;

        // A product needs a standard price before it can have a custom price.
        List<PricebookEntry> entries = new List<PricebookEntry>();
        for (Product2 product : products) {
            entries.add(new PricebookEntry(
                Pricebook2Id = standardPricebookId, Product2Id = product.Id,
                UnitPrice = 100, IsActive = true));
        }
        insert entries;

        List<PricebookEntry> customEntries = new List<PricebookEntry>();
        for (Product2 product : products) {
            customEntries.add(new PricebookEntry(
                Pricebook2Id = customPricebook.Id, Product2Id = product.Id,
                UnitPrice = 100, IsActive = true));
        }
        insert customEntries;

        List<Opportunity> opps = new List<Opportunity>{
            new Opportunity(Name = 'Opp With Lines', StageName = 'Prospecting',
                CloseDate = Date.today().addDays(30), Pricebook2Id = customPricebook.Id),
            new Opportunity(Name = 'Opp Without Lines', StageName = 'Prospecting',
                CloseDate = Date.today().addDays(30), Pricebook2Id = customPricebook.Id)
        };
        insert opps;

        List<OpportunityLineItem> lines = new List<OpportunityLineItem>();
        for (PricebookEntry entry : customEntries) {
            lines.add(new OpportunityLineItem(
                OpportunityId = opps[0].Id, PricebookEntryId = entry.Id,
                Quantity = 1, UnitPrice = 100));
        }
        insert lines;
    }

    private static Opportunity oppWithLines() {
        return [SELECT Id FROM Opportunity WHERE Name = 'Opp With Lines' LIMIT 1];
    }

    @IsTest
    static void getLineItems_returnsRelatedLinesWithProductName() {
        List<OpportunityLineItem> result =
            BulkLineItemEditorController.getLineItems(oppWithLines().Id);

        System.assertEquals(3, result.size(), 'All line items should be returned');
        System.assert(result[0].Product2.Name.startsWith('Test Product'),
            'Product name should be queried through the relationship');
    }

    @IsTest
    static void getLineItems_emptyOpportunity_returnsEmptyList() {
        Opportunity empty = [SELECT Id FROM Opportunity WHERE Name = 'Opp Without Lines' LIMIT 1];

        System.assert(BulkLineItemEditorController.getLineItems(empty.Id).isEmpty(),
            'An Opportunity without products should return an empty list');
    }

    @IsTest
    static void updateLineItems_allValid_savesEveryRow() {
        List<OpportunityLineItem> existing =
            BulkLineItemEditorController.getLineItems(oppWithLines().Id);

        List<OpportunityLineItem> edits = new List<OpportunityLineItem>();
        for (OpportunityLineItem line : existing) {
            edits.add(new OpportunityLineItem(
                Id = line.Id, Quantity = 5, UnitPrice = 250, Discount__c = 10,
                ServiceDate = Date.today().addDays(7), Description = 'Updated'));
        }

        Test.startTest();
        List<BulkLineItemEditorController.RowResult> results =
            BulkLineItemEditorController.updateLineItems(edits);
        Test.stopTest();

        System.assertEquals(3, results.size());
        for (BulkLineItemEditorController.RowResult row : results) {
            System.assert(row.success, 'Row should save: ' + row.messages);
            System.assert(row.messages.isEmpty());
        }
        for (OpportunityLineItem saved : BulkLineItemEditorController.getLineItems(oppWithLines().Id)) {
            System.assertEquals(5, saved.Quantity);
            System.assertEquals(250, saved.UnitPrice);
            System.assertEquals(10, saved.Discount__c);
            System.assertEquals(Date.today().addDays(7), saved.ServiceDate);
            System.assertEquals('Updated', saved.Description);
        }
    }

    @IsTest
    static void updateLineItems_partialFailure_savesValidRowsAndReportsInvalid() {
        List<OpportunityLineItem> existing =
            BulkLineItemEditorController.getLineItems(oppWithLines().Id);

        // Description is limited to 255 characters, so row 2 must fail.
        List<OpportunityLineItem> edits = new List<OpportunityLineItem>{
            new OpportunityLineItem(Id = existing[0].Id, Quantity = 9),
            new OpportunityLineItem(Id = existing[1].Id, Description = 'x'.repeat(300)),
            new OpportunityLineItem(Id = existing[2].Id, Quantity = 7)
        };

        List<BulkLineItemEditorController.RowResult> results =
            BulkLineItemEditorController.updateLineItems(edits);

        System.assertEquals(3, results.size());
        System.assert(results[0].success, 'First row is valid');
        System.assert(!results[1].success, 'Second row is invalid');
        System.assert(!results[1].messages.isEmpty(), 'Failed row carries an error message');
        System.assertEquals(existing[1].Id, results[1].recordId);
        System.assert(results[2].success, 'Third row is valid and must not be blocked');

        Map<Id, OpportunityLineItem> byId = new Map<Id, OpportunityLineItem>(
            BulkLineItemEditorController.getLineItems(oppWithLines().Id));
        System.assertEquals(9, byId.get(existing[0].Id).Quantity);
        System.assertEquals(7, byId.get(existing[2].Id).Quantity);
        System.assertEquals(existing[1].Description, byId.get(existing[1].Id).Description,
            'Failed row must not be changed');
    }

    @IsTest
    static void updateLineItems_emptyOrNullList_returnsEmptyList() {
        System.assert(BulkLineItemEditorController.updateLineItems(null).isEmpty());
        System.assert(BulkLineItemEditorController.updateLineItems(
            new List<OpportunityLineItem>()).isEmpty());
    }

    @IsTest
    static void updateLineItems_missingId_reportsRowErrorWithoutBlockingOthers() {
        OpportunityLineItem existing =
            BulkLineItemEditorController.getLineItems(oppWithLines().Id)[0];

        List<BulkLineItemEditorController.RowResult> results =
            BulkLineItemEditorController.updateLineItems(new List<OpportunityLineItem>{
                new OpportunityLineItem(Quantity = 3),
                new OpportunityLineItem(Id = existing.Id, Quantity = 4)
            });

        System.assert(!results[0].success, 'A row with no Id cannot be saved');
        System.assert(results[1].success, 'The valid row is still saved');
    }

    @IsTest
    static void updateLineItems_ignoresFieldsThatAreNotEditable() {
        List<OpportunityLineItem> existing =
            BulkLineItemEditorController.getLineItems(oppWithLines().Id);
        Opportunity other = [SELECT Id FROM Opportunity WHERE Name = 'Opp Without Lines' LIMIT 1];

        List<BulkLineItemEditorController.RowResult> results =
            BulkLineItemEditorController.updateLineItems(new List<OpportunityLineItem>{
                new OpportunityLineItem(Id = existing[0].Id, OpportunityId = other.Id, Quantity = 2)
            });

        System.assert(results[0].success, 'Non-editable fields are dropped, not rejected');
        OpportunityLineItem saved = [
            SELECT OpportunityId, Quantity FROM OpportunityLineItem WHERE Id = :existing[0].Id
        ];
        System.assertEquals(2, saved.Quantity);
        System.assertNotEquals(other.Id, saved.OpportunityId, 'Parent must not change');
    }
}
