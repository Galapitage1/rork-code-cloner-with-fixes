# Debugging Live Inventory - Sales Not Showing

## Problem
Some sales from reconciliation are not showing in the Live Inventory "Sold" column.

## Root Cause Analysis

The issue is likely one of the following:

### 1. **Outlet Name Mismatch**
The outlet name from reconciliation must EXACTLY match the outlet name selected in Live Inventory (case-insensitive).

**Check this in console logs:**
- Look for: `Available outlets in salesDeductions:` in the Live Inventory console
- Compare with the outlet name you selected
- Even a single space difference will cause a mismatch

### 2. **Date Format Mismatch**  
The sales date must be in YYYY-MM-DD format and match the date you're viewing in Live Inventory.

**Check this in console logs:**
- Look for: `Available dates for this product:` in the Live Inventory console
- The format must be: `2025-MM-DD` (year-month-day)

### 3. **Product Not Processed During Reconciliation**
The product might not have been included in the reconciliation file or failed to process.

**Check this in console logs:**
- Look for: `SalesUpload: Deducted X whole + Y slices of PRODUCT_NAME`
- This confirms the deduction was created

## How to Debug

### Step 1: Check Sales Deductions in Storage
Open the app, go to Settings, and check the `salesDeductions` count. It should show how many sales records are stored.

### Step 2: Check Console Logs
When you open Live Inventory:

1. Select your outlet
2. Select the date range that includes your sales date
3. Look for these log messages:

```
=== CHECKING SOLD FOR ProductName on 2025-XX-XX ===
Total salesDeductions in system: XXX
Selected outlet: "YourOutlet"
Target date: "2025-XX-XX"
Product ID looking for: product_xxx
Sales deductions for product product_xxx: X
```

If you see `Sales deductions for product: 0`, the problem is identified.

### Step 3: Check Reconciliation Logs
When you do sales reconciliation, look for:

```
SalesUpload: Processing inventory deductions for OutletName on 2025-XX-XX
SalesUpload: Deducted X whole + Y slices of ProductName
```

If you DON'T see these messages, the sales were not processed.

## Solutions

### Solution 1: Re-run Reconciliation
If the sales weren't processed correctly:

1. Go to Sales Upload tab
2. Upload the same Excel file again
3. Make sure the date in the Excel matches the stock check date
4. Check console logs to confirm deductions are created

### Solution 2: Check Outlet Names
If outlet names don't match:

1. Go to Settings → Outlets
2. Check the exact spelling of your outlet name
3. Compare with the Excel file cell J5 (outlet name)
4. Make sure they match EXACTLY (spaces, capitalization don't matter but spelling does)

### Solution 3: Check Date Formats
If dates don't match:

1. The Excel file cell H9 should have the date in DD/MM/YYYY format
2. The system converts it to YYYY-MM-DD internally
3. Make sure the date in your stock check matches the sales date

### Solution 4: Clear and Re-sync (Last Resort)
If nothing works:

1. Go to Settings
2. Clear Sales Deductions
3. Re-run all your sales reconciliations
4. This will recreate all sales records

## Prevention

To avoid this issue in the future:

1. Always check console logs after reconciliation
2. Verify the "Sold" column in Live Inventory immediately after reconciliation
3. Make sure outlet names in Excel match outlet names in the app EXACTLY
4. Always use the DD/MM/YYYY date format in Excel cell H9

## Technical Details

**Where Sales Data is Stored:**
- File: `@/contexts/StockContext.tsx`
- Function: `deductInventoryFromSales` (line 2424)
- Storage key: `@stock_app_sales_deductions`

**Where Sales Data is Read:**
- File: `app/(tabs)/live-inventory.tsx`  
- Lines: 244-298
- The filter checks outlet name, date, and product ID

**Matching Logic:**
```typescript
// Exact match first
salesForDate = salesDeductions.filter(
  s => s.outletName === selectedOutlet && 
       s.salesDate === date && 
       s.productId === pair.wholeId
);

// Fallback to case-insensitive if no exact match
if (salesForDate.length === 0) {
  salesForDate = salesDeductions.filter(
    s => s.outletName.toLowerCase().trim() === selectedOutlet.toLowerCase().trim() && 
         s.salesDate === date && 
         s.productId === pair.wholeId
  );
}
```

## Contact
If you still have issues after trying these solutions, please provide:
1. Console logs from Live Inventory (the "CHECKING SOLD" section)
2. Console logs from Sales Upload (the "Processing inventory deductions" section)
3. The outlet name and date you're trying to view
