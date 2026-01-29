import * as XLSX from 'xlsx';
import { Recipe, Product, ProductConversion } from '@/types';

export interface PendingIngredient {
  ingredientName: string;
  quantity: number;
  unit: string;
  sheetName: string;
}

export interface UnmatchedItem {
  type: 'menu' | 'ingredient';
  originalName: string;
  originalUnit: string;
  menuProductUnit?: string; // For menu items, the unit from Column B
  forProduct?: string; // For ingredients, the menu product name
  forProductId?: string; // For ingredients, the menu product id
  quantity?: number; // For ingredients
  rowData?: {
    productName: string;
    productUnit: string;
    ingredientName: string;
    quantity: number;
    unit: string;
  };
  possibleMatches: Product[];
  pendingIngredients?: PendingIngredient[]; // For menu items, the ingredients to be added after matching
}

export interface ParsedRecipeData {
  recipes: Recipe[];
  errors: string[];
  warnings: string[];
  unmatchedItems: UnmatchedItem[];
}

function normalizeUnit(unit: string): string {
  const trimmed = unit.trim();
  if (trimmed.startsWith('1')) {
    return trimmed.substring(1).trim();
  }
  return trimmed;
}

function parseQuantityWithUnit(value: string): { quantity: number; unit: string } {
  const trimmed = value.trim();
  const match = trimmed.match(/^([0-9.]+)\s*(.*)$/);
  if (match) {
    return {
      quantity: parseFloat(match[1]) || 0,
      unit: normalizeUnit(match[2] || '')
    };
  }
  return { quantity: 0, unit: '' };
}

function findClosestMatches(name: string, unit: string, products: Product[], limit: number = 5): Product[] {
  const normalizedName = name.toLowerCase().trim();
  const normalizedUnit = unit.toLowerCase().trim();
  
  const scored = products.map(p => {
    let score = 0;
    const pName = p.name.toLowerCase();
    const pUnit = p.unit.toLowerCase();
    
    // Exact name match
    if (pName === normalizedName) score += 100;
    // Name contains search or vice versa
    else if (pName.includes(normalizedName) || normalizedName.includes(pName)) score += 50;
    // Partial word match
    else {
      const searchWords = normalizedName.split(/\s+/);
      const productWords = pName.split(/\s+/);
      const matchingWords = searchWords.filter(sw => 
        productWords.some(pw => pw.includes(sw) || sw.includes(pw))
      );
      score += matchingWords.length * 20;
    }
    
    // Unit matching bonus
    if (pUnit === normalizedUnit) score += 30;
    else if (pUnit.includes(normalizedUnit) || normalizedUnit.includes(pUnit)) score += 15;
    
    return { product: p, score };
  });
  
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.product);
}

export function parseRecipeExcelFile(
  base64Data: string, 
  existingProducts: Product[], 
  productConversions: ProductConversion[] = [],
  existingRecipes: Recipe[] = []
): ParsedRecipeData {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recipes: Recipe[] = [];
  const unmatchedItems: UnmatchedItem[] = [];

  try {
    const workbook = XLSX.read(base64Data, { type: 'base64' });
    
    if (workbook.SheetNames.length === 0) {
      errors.push('Excel file has no sheets');
      return { recipes: [], errors, warnings, unmatchedItems: [] };
    }

    const menuProducts = existingProducts.filter(p => p.type === 'menu');
    const rawProducts = existingProducts.filter(p => p.type === 'raw');
    
    const conversionsByFromId = new Map<string, { toProductId: string; factor: number }>();
    productConversions.forEach(conv => {
      conversionsByFromId.set(conv.fromProductId, { toProductId: conv.toProductId, factor: conv.conversionFactor });
    });

    // Structure to hold pending ingredients for unmatched menu products
    // Key: "originalMenuName|originalMenuUnit", Value: array of ingredients
    const pendingIngredientsForUnmatchedMenu = new Map<string, Array<{
      ingredientName: string;
      quantity: number;
      unit: string;
      sheetName: string;
    }>>();

    for (const sheetName of workbook.SheetNames) {
      console.log(`\n[RecipeParser] ========================================`);
      console.log(`[RecipeParser] Processing sheet: "${sheetName}"`);
      
      const sheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
      
      console.log(`[RecipeParser] Sheet has ${range.e.r + 1} rows (0-${range.e.r})`);
      
      let rowsWithProducts = 0;
      let rowsProcessed = 0;
      let ingredientsFound = 0;
      
      // NEW FORMAT: Check columns A, B, C, D
      for (let row = 0; row <= range.e.r; row++) {
        const productNameCell = sheet[`A${row + 1}`];
        
        if (!productNameCell || !productNameCell.v || String(productNameCell.v).trim() === '') {
          continue;
        }

        const productName = String(productNameCell.v).trim();
        rowsWithProducts++;
        
        const productUnitCell = sheet[`B${row + 1}`];
        const productUnit = productUnitCell && productUnitCell.v ? String(productUnitCell.v).trim() : '';
        
        const ingredientNameCell = sheet[`C${row + 1}`];
        if (!ingredientNameCell || !ingredientNameCell.v) {
          console.log(`[RecipeParser] Sheet "${sheetName}" Row ${row + 1}: Product "${productName}" found in Column A, but no ingredient in Column C - skipping`);
          continue;
        }
        const ingredientName = String(ingredientNameCell.v).trim();
        ingredientsFound++;
        
        const quantityWithUnitCell = sheet[`D${row + 1}`];
        if (!quantityWithUnitCell || !quantityWithUnitCell.v) {
          continue;
        }
        const quantityWithUnit = String(quantityWithUnitCell.v).trim();
        const { quantity, unit } = parseQuantityWithUnit(quantityWithUnit);

        if (quantity <= 0) {
          console.log(`[RecipeParser] Sheet "${sheetName}" Row ${row + 1}: Invalid quantity "${quantityWithUnit}" - skipping`);
          continue;
        }
        
        console.log(`[RecipeParser] NEW FORMAT - Sheet "${sheetName}" Row ${row + 1}: Processing "${productName}" + "${ingredientName}" (${quantity} ${unit})`);

        let matchedProduct = menuProducts.find(p => 
          p.name.toLowerCase() === productName.toLowerCase() &&
          (!productUnit || p.unit.toLowerCase().includes(productUnit.toLowerCase()) || productUnit.toLowerCase().includes(p.unit.toLowerCase()))
        );
        
        if (!matchedProduct) {
          matchedProduct = menuProducts.find(p => 
            p.name.toLowerCase() === productName.toLowerCase()
          );
        }
        
        if (!matchedProduct) {
          matchedProduct = menuProducts.find(p => 
            p.name.toLowerCase().includes(productName.toLowerCase()) ||
            productName.toLowerCase().includes(p.name.toLowerCase())
          );
        }
        
        if (!matchedProduct) {
          console.log(`[RecipeParser] Sheet "${sheetName}" Row ${row + 1}: Menu product "${productName}" not found in system`);
          const possibleMatches = findClosestMatches(productName, productUnit, menuProducts);
          const menuKey = `${productName.toLowerCase()}`;
          
          const existingUnmatched = unmatchedItems.find(
            u => u.type === 'menu' && u.originalName.toLowerCase() === productName.toLowerCase()
          );
          
          if (!existingUnmatched) {
            unmatchedItems.push({
              type: 'menu',
              originalName: productName,
              originalUnit: productUnit,
              menuProductUnit: productUnit,
              possibleMatches,
            });
            if (possibleMatches.length > 0) {
              warnings.push(`Menu product "${productName}"${productUnit ? ` (${productUnit})` : ''} - possible match: ${possibleMatches[0].name} (${possibleMatches[0].unit})`);
            } else {
              warnings.push(`Menu product "${productName}"${productUnit ? ` (${productUnit})` : ''} - no matches found in system`);
            }
          }
          
          const pendingKey = productName.toLowerCase();
          if (!pendingIngredientsForUnmatchedMenu.has(pendingKey)) {
            pendingIngredientsForUnmatchedMenu.set(pendingKey, []);
          }
          pendingIngredientsForUnmatchedMenu.get(pendingKey)!.push({
            ingredientName,
            quantity,
            unit,
            sheetName,
          });
          
          continue;
        }
        
        console.log(`[RecipeParser] Sheet "${sheetName}" Row ${row + 1}: ✓ Matched menu product "${productName}" → "${matchedProduct.name}"`);

        const existingRecipeInSystem = existingRecipes.find(r => r.menuProductId === matchedProduct!.id);
        
        let matchedRaw = rawProducts.find(p => 
          p.name.toLowerCase() === ingredientName.toLowerCase() && 
          p.unit.toLowerCase() === unit.toLowerCase()
        );
        
        if (!matchedRaw) {
          matchedRaw = rawProducts.find(p => 
            p.name.toLowerCase() === ingredientName.toLowerCase()
          );
        }
        
        if (!matchedRaw) {
          matchedRaw = rawProducts.find(p => 
            p.name.toLowerCase().includes(ingredientName.toLowerCase()) ||
            ingredientName.toLowerCase().includes(p.name.toLowerCase())
          );
        }

        if (!matchedRaw) {
          console.log(`[RecipeParser] Sheet "${sheetName}" Row ${row + 1}: Ingredient "${ingredientName}" not found in system`);
          const possibleMatches = findClosestMatches(ingredientName, unit, rawProducts);
          const existingUnmatched = unmatchedItems.find(
            u => u.type === 'ingredient' && 
                 u.originalName.toLowerCase() === ingredientName.toLowerCase() && 
                 u.forProductId === matchedProduct!.id
          );
          if (!existingUnmatched) {
            unmatchedItems.push({
              type: 'ingredient',
              originalName: ingredientName,
              originalUnit: unit,
              forProduct: productName,
              forProductId: matchedProduct.id,
              quantity,
              rowData: {
                productName,
                productUnit: matchedProduct.unit,
                ingredientName,
                quantity,
                unit,
              },
              possibleMatches,
            });
            if (possibleMatches.length > 0) {
              warnings.push(`Ingredient "${ingredientName}" (${unit}) for ${productName} - possible match: ${possibleMatches[0].name} (${possibleMatches[0].unit})`);
            } else {
              warnings.push(`Ingredient "${ingredientName}" (${unit}) for ${productName} - no matches found`);
            }
          }
          continue;
        }
        
        console.log(`[RecipeParser] Sheet "${sheetName}" Row ${row + 1}: ✓ Matched ingredient "${ingredientName}" → "${matchedRaw.name}"`);
        rowsProcessed++;

        if (existingRecipeInSystem) {
          const ingredientAlreadyInSystemRecipe = existingRecipeInSystem.components.find(
            c => c.rawProductId === matchedRaw!.id
          );
          if (ingredientAlreadyInSystemRecipe) {
            console.log(`[RecipeParser] Ingredient ${matchedRaw.name} already in recipe for ${matchedProduct.name}, skipping`);
            continue;
          }
          console.log(`[RecipeParser] Adding new ingredient ${matchedRaw.name} to existing recipe for ${matchedProduct.name}`);
        }

        const existingRecipeForProduct = recipes.find(r => r.menuProductId === matchedProduct!.id);
        if (existingRecipeForProduct) {
          const existingComponent = existingRecipeForProduct.components.find(
            c => c.rawProductId === matchedRaw!.id
          );
          if (!existingComponent) {
            existingRecipeForProduct.components.push({
              rawProductId: matchedRaw.id,
              quantityPerUnit: quantity
            });
          }
        } else {
          const recipe: Recipe = {
            id: `rcp-${matchedProduct.id}`,
            menuProductId: matchedProduct.id,
            components: [{
              rawProductId: matchedRaw.id,
              quantityPerUnit: quantity
            }],
            updatedAt: Date.now()
          };
          recipes.push(recipe);
        }
      }
      
      // OLD FORMAT: Check columns P, F, I, O, R
      let oldFormatRowsProcessed = 0;
      for (let row = 0; row <= range.e.r; row++) {
        const menuProductNameCell = sheet[`P${row + 1}`];
        
        if (!menuProductNameCell || !menuProductNameCell.v || String(menuProductNameCell.v).trim() === '') {
          continue;
        }

        const menuProductName = String(menuProductNameCell.v).trim();
        
        const menuProductUnitCell = sheet[`F${row + 3}`];
        const menuProductUnit = menuProductUnitCell && menuProductUnitCell.v ? String(menuProductUnitCell.v).trim() : '';
        
        console.log(`[RecipeParser] OLD FORMAT - Sheet "${sheetName}" Row ${row + 1}: Found menu product "${menuProductName}" (${menuProductUnit})`);
        
        let matchedMenuProduct = menuProducts.find(p => 
          p.name.toLowerCase() === menuProductName.toLowerCase() &&
          (!menuProductUnit || p.unit.toLowerCase().includes(menuProductUnit.toLowerCase()) || menuProductUnit.toLowerCase().includes(p.unit.toLowerCase()))
        );
        
        if (!matchedMenuProduct) {
          matchedMenuProduct = menuProducts.find(p => 
            p.name.toLowerCase() === menuProductName.toLowerCase()
          );
        }
        
        if (!matchedMenuProduct) {
          matchedMenuProduct = menuProducts.find(p => 
            p.name.toLowerCase().includes(menuProductName.toLowerCase()) ||
            menuProductName.toLowerCase().includes(p.name.toLowerCase())
          );
        }
        
        if (!matchedMenuProduct) {
          console.log(`[RecipeParser] OLD FORMAT - Sheet "${sheetName}" Row ${row + 1}: Menu product "${menuProductName}" not found`);
          const possibleMatches = findClosestMatches(menuProductName, menuProductUnit, menuProducts);
          const existingUnmatched = unmatchedItems.find(
            u => u.type === 'menu' && u.originalName.toLowerCase() === menuProductName.toLowerCase()
          );
          if (!existingUnmatched) {
            unmatchedItems.push({
              type: 'menu',
              originalName: menuProductName,
              originalUnit: menuProductUnit,
              menuProductUnit: menuProductUnit,
              possibleMatches,
            });
          }
          continue;
        }
        
        console.log(`[RecipeParser] OLD FORMAT - Sheet "${sheetName}" Row ${row + 1}: ✓ Matched menu product "${menuProductName}" → "${matchedMenuProduct.name}"`);
        
        for (let ingredientRow = row + 6; ingredientRow <= range.e.r; ingredientRow++) {
          const ingredientNameCell = sheet[`I${ingredientRow + 1}`];
          
          if (!ingredientNameCell || !ingredientNameCell.v || String(ingredientNameCell.v).trim() === '') {
            console.log(`[RecipeParser] OLD FORMAT - Sheet "${sheetName}" Row ${ingredientRow + 1}: Empty ingredient, stopping for this menu product`);
            break;
          }
          
          const ingredientName = String(ingredientNameCell.v).trim();
          
          const ingredientUnitCell = sheet[`O${ingredientRow + 1}`];
          const ingredientUnit = ingredientUnitCell && ingredientUnitCell.v ? String(ingredientUnitCell.v).trim() : '';
          
          const quantityCell = sheet[`R${ingredientRow + 1}`];
          if (!quantityCell || !quantityCell.v) {
            console.log(`[RecipeParser] OLD FORMAT - Sheet "${sheetName}" Row ${ingredientRow + 1}: No quantity for ingredient "${ingredientName}" - skipping`);
            continue;
          }
          
          const quantity = typeof quantityCell.v === 'number' ? quantityCell.v : parseFloat(String(quantityCell.v));
          
          if (quantity <= 0 || isNaN(quantity)) {
            console.log(`[RecipeParser] OLD FORMAT - Sheet "${sheetName}" Row ${ingredientRow + 1}: Invalid quantity "${quantityCell.v}" - skipping`);
            continue;
          }
          
          console.log(`[RecipeParser] OLD FORMAT - Sheet "${sheetName}" Row ${ingredientRow + 1}: Processing ingredient "${ingredientName}" (${quantity} ${ingredientUnit})`);
          
          let matchedRaw = rawProducts.find(p => 
            p.name.toLowerCase() === ingredientName.toLowerCase() && 
            p.unit.toLowerCase() === ingredientUnit.toLowerCase()
          );
          
          if (!matchedRaw) {
            matchedRaw = rawProducts.find(p => 
              p.name.toLowerCase() === ingredientName.toLowerCase()
            );
          }
          
          if (!matchedRaw) {
            matchedRaw = rawProducts.find(p => 
              p.name.toLowerCase().includes(ingredientName.toLowerCase()) ||
              ingredientName.toLowerCase().includes(p.name.toLowerCase())
            );
          }
          
          if (!matchedRaw) {
            console.log(`[RecipeParser] OLD FORMAT - Sheet "${sheetName}" Row ${ingredientRow + 1}: Ingredient "${ingredientName}" not found`);
            const possibleMatches = findClosestMatches(ingredientName, ingredientUnit, rawProducts);
            const existingUnmatched = unmatchedItems.find(
              u => u.type === 'ingredient' && 
                   u.originalName.toLowerCase() === ingredientName.toLowerCase() && 
                   u.forProductId === matchedMenuProduct!.id
            );
            if (!existingUnmatched) {
              unmatchedItems.push({
                type: 'ingredient',
                originalName: ingredientName,
                originalUnit: ingredientUnit,
                forProduct: menuProductName,
                forProductId: matchedMenuProduct.id,
                quantity,
                rowData: {
                  productName: menuProductName,
                  productUnit: matchedMenuProduct.unit,
                  ingredientName,
                  quantity,
                  unit: ingredientUnit,
                },
                possibleMatches,
              });
            }
            continue;
          }
          
          console.log(`[RecipeParser] OLD FORMAT - Sheet "${sheetName}" Row ${ingredientRow + 1}: ✓ Matched ingredient "${ingredientName}" → "${matchedRaw.name}"`);
          oldFormatRowsProcessed++;
          
          const existingRecipeForProduct = recipes.find(r => r.menuProductId === matchedMenuProduct!.id);
          if (existingRecipeForProduct) {
            const existingComponent = existingRecipeForProduct.components.find(
              c => c.rawProductId === matchedRaw!.id
            );
            if (!existingComponent) {
              existingRecipeForProduct.components.push({
                rawProductId: matchedRaw.id,
                quantityPerUnit: quantity
              });
            } else {
              existingComponent.quantityPerUnit = quantity;
            }
          } else {
            const recipe: Recipe = {
              id: `rcp-${matchedMenuProduct.id}`,
              menuProductId: matchedMenuProduct.id,
              components: [{
                rawProductId: matchedRaw.id,
                quantityPerUnit: quantity
              }],
              updatedAt: Date.now()
            };
            recipes.push(recipe);
          }
        }
      }
      
      console.log(`[RecipeParser] Sheet "${sheetName}" Summary:`);
      console.log(`[RecipeParser]   NEW FORMAT - Rows with products in Column A: ${rowsWithProducts}`);
      console.log(`[RecipeParser]   NEW FORMAT - Rows with valid ingredients in Column C: ${ingredientsFound}`);
      console.log(`[RecipeParser]   NEW FORMAT - Rows successfully processed: ${rowsProcessed}`);
      console.log(`[RecipeParser]   OLD FORMAT - Rows successfully processed: ${oldFormatRowsProcessed}`);
      console.log(`[RecipeParser] ========================================\n`);
    }
    
    console.log(`[RecipeParser] \n*** FINISHED PROCESSING ALL ${workbook.SheetNames.length} SHEETS ***`);
    console.log(`[RecipeParser] Total recipes created/updated: ${recipes.length}`);
    console.log(`[RecipeParser] Total unmatched items: ${unmatchedItems.length}\n`);
    
    // Store pending ingredients info in unmatched menu items for later resolution
    unmatchedItems.forEach(item => {
      if (item.type === 'menu') {
        const pendingKey = item.originalName.toLowerCase();
        const pendingIngredients = pendingIngredientsForUnmatchedMenu.get(pendingKey);
        if (pendingIngredients && pendingIngredients.length > 0) {
          (item as any).pendingIngredients = pendingIngredients;
        }
      }
    });

    const recipesWithConversions: Recipe[] = [];
    for (const recipe of recipes) {
      recipesWithConversions.push(recipe);
      
      
      const conversion = conversionsByFromId.get(recipe.menuProductId);
      if (conversion) {
        const convertedProduct = existingProducts.find(p => p.id === conversion.toProductId);
        if (convertedProduct) {
          const existingConvertedRecipe = existingRecipes.find(r => r.menuProductId === convertedProduct.id);
          if (!existingConvertedRecipe) {
            const convertedComponents = recipe.components.map(comp => ({
              rawProductId: comp.rawProductId,
              quantityPerUnit: comp.quantityPerUnit / conversion.factor
            }));
            
            const convertedRecipe: Recipe = {
              id: `rcp-${convertedProduct.id}`,
              menuProductId: convertedProduct.id,
              components: convertedComponents,
              updatedAt: Date.now()
            };
            recipesWithConversions.push(convertedRecipe);
            
          } else {
            
          }
        }
      }
    }

    if (recipesWithConversions.length === 0 && errors.length === 0) {
      errors.push('No valid recipes found in the Excel file');
    }

  } catch (error) {
    errors.push(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return { recipes, errors, warnings, unmatchedItems };
}
