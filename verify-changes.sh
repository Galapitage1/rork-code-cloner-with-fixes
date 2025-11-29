#!/bin/bash

# ========================================
# VERIFY SOURCE CODE CHANGES
# ========================================
# This script checks that your requested
# changes are in the source code
# ========================================

echo ""
echo "🔍 Verifying changes in source code..."
echo ""

ISSUES=0

# Check 1: Home page title
echo "1️⃣  Checking home page title..."
if grep -q "WELCOME TO THE ENGLISH CAKE COMPANY" app/home.tsx; then
  echo "   ✅ Home page title is correct"
else
  echo "   ❌ Home page title NOT found"
  ISSUES=$((ISSUES+1))
fi

# Check 2: Live inventory persistence
echo ""
echo "2️⃣  Checking live inventory code..."
if grep -q "productInventoryHistory = useMemo" app/\(tabs\)/live-inventory.tsx; then
  echo "   ✅ Live inventory uses useMemo (should keep data)"
else
  echo "   ⚠️  useMemo pattern not found"
fi

# Check dependencies that should keep data stable
if grep -q "stockChecks, salesDeductions, productConversions, requests" app/\(tabs\)/live-inventory.tsx; then
  echo "   ✅ Proper dependencies for persistence"
else
  echo "   ⚠️  Dependencies might not be optimal"
fi

# Check 3: Discrepancy calculation from visible values
echo ""
echo "3️⃣  Checking discrepancy calculation..."
if grep -q "CALCULATE DISCREPANCY ONLY FROM VISIBLE VALUES IN THIS ROW" app/\(tabs\)/live-inventory.tsx; then
  echo "   ✅ Discrepancy calculation comment found"
  
  if grep -q "openingWhole.*openingSlices.*receivedWhole.*receivedSlices.*wastageWhole.*wastageSlices.*soldWhole.*soldSlices" app/\(tabs\)/live-inventory.tsx; then
    echo "   ✅ Using visible values for calculation"
  else
    echo "   ⚠️  Calculation might not use visible values"
  fi
else
  echo "   ❌ Discrepancy calculation code NOT found"
  ISSUES=$((ISSUES+1))
fi

echo ""
echo "========================================="

if [ $ISSUES -eq 0 ]; then
  echo "✅ All changes are in source code!"
  echo ""
  echo "If they're not showing on your website:"
  echo "1. You need to rebuild (run ./deploy-prep.sh)"
  echo "2. You need to upload the new build"
  echo "3. You need to clear browser cache"
  echo ""
  exit 0
else
  echo "❌ Some changes are MISSING from source code!"
  echo ""
  echo "This means the changes weren't properly saved."
  echo "Please report this issue."
  echo ""
  exit 1
fi
