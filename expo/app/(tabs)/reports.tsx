import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, ActivityIndicator, Modal } from 'react-native';
import { useState } from 'react';
import { FileText, Download, Calendar, AlertTriangle } from 'lucide-react-native';
import { useStock } from '@/contexts/StockContext';
import { useCustomers } from '@/contexts/CustomerContext';
import { useRecipes } from '@/contexts/RecipeContext';
import { useStores } from '@/contexts/StoresContext';

import Colors from '@/constants/colors';
import { CalendarModal } from '@/components/CalendarModal';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';


type ReportType =
  | 'inventory'
  | 'stockMovement'
  | 'requests'
  | 'lowStock'
  | 'customers'
  | 'products'
  | 'outletPerformance'
  | 'wastage'
  | 'aiDiscrepancy';

interface ReportOption {
  id: ReportType;
  title: string;
  description: string;
  icon: typeof FileText;
  requiresDateRange: boolean;
}

const REPORT_OPTIONS: ReportOption[] = [
  {
    id: 'inventory',
    title: 'Inventory Summary',
    description: 'Current stock levels across all locations',
    icon: FileText,
    requiresDateRange: false,
  },
  {
    id: 'stockMovement',
    title: 'Stock Movement',
    description: 'Stock checks history with opening, received, wastage',
    icon: FileText,
    requiresDateRange: true,
  },
  {
    id: 'requests',
    title: 'Request History',
    description: 'All requests with status within date range',
    icon: FileText,
    requiresDateRange: true,
  },
  {
    id: 'lowStock',
    title: 'Low Stock Alert',
    description: 'Products below minimum stock levels',
    icon: FileText,
    requiresDateRange: false,
  },
  {
    id: 'customers',
    title: 'Customer Summary',
    description: 'Customer list with contact information',
    icon: FileText,
    requiresDateRange: false,
  },
  {
    id: 'products',
    title: 'Product List',
    description: 'Complete product catalog with details',
    icon: FileText,
    requiresDateRange: false,
  },
  {
    id: 'outletPerformance',
    title: 'Outlet Performance',
    description: 'Stock transfers and activity by outlet',
    icon: FileText,
    requiresDateRange: true,
  },
  {
    id: 'wastage',
    title: 'Wastage Report',
    description: 'Products wasted during stock checks',
    icon: FileText,
    requiresDateRange: true,
  },
  {
    id: 'aiDiscrepancy',
    title: 'Discrepancy Analysis Report',
    description: 'Detailed analysis of stock discrepancies and missing items',
    icon: AlertTriangle,
    requiresDateRange: true,
  },
];

export default function ReportsScreen() {
  const { products, stockChecks, requests, outlets, inventoryStocks, currentStockCounts, isLoading } = useStock();
  const { customers } = useCustomers();
  const { recipes } = useRecipes();
  const { storeProducts } = useStores();


  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [showStartCalendar, setShowStartCalendar] = useState<boolean>(false);
  const [showEndCalendar, setShowEndCalendar] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [selectedOutlet, setSelectedOutlet] = useState<string>('ALL');
  const [analysisReport, setAnalysisReport] = useState<string>('');
  const [showAnalysisReport, setShowAnalysisReport] = useState<boolean>(false);
  const [isGeneratingAnalysis, setIsGeneratingAnalysis] = useState<boolean>(false);

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const generateInventoryReport = () => {
    const data: any[] = [];
    
    inventoryStocks.forEach(inv => {
      const product = products.find(p => p.id === inv.productId);
      if (!product) return;

      const row: any = {
        'Product': product.name,
        'Unit': product.unit,
        'Category': product.category || 'N/A',
        'Production Whole': inv.productionWhole || 0,
        'Production Slices': inv.productionSlices || 0,
      };

      inv.outletStocks.forEach(os => {
        row[`${os.outletName} Whole`] = os.whole || 0;
        row[`${os.outletName} Slices`] = os.slices || 0;
      });

      data.push(row);
    });

    return data;
  };

  const calculateProductCost = (productId: string, quantity: number): number => {
    const product = products.find(p => p.id === productId);
    const recipe = recipes.find(r => r.menuProductId === productId);
    
    if (!recipe) {
      return 0;
    }
    
    if (!recipe.components || recipe.components.length === 0) {
      return 0;
    }
    
    let totalCost = 0;
    
    const normalizeUnit = (unit: string): string => {
      const normalized = unit.toLowerCase().trim();
      return normalized.replace(/^1/, '').trim();
    };
    
    for (const component of recipe.components) {
      const rawProduct = products.find(p => p.id === component.rawProductId);
      
      if (!rawProduct) {
        continue;
      }
      
      const qtyPerUnit = typeof component.quantityPerUnit === 'number' ? component.quantityPerUnit : parseFloat(component.quantityPerUnit as any) || 0;
      
      const storeProduct = storeProducts.find(sp => {
        const nameMatch = sp.name.toLowerCase().trim() === rawProduct.name.toLowerCase().trim();
        const recipeUnit = normalizeUnit(rawProduct.unit);
        const storeUnit = normalizeUnit(sp.unit);
        const unitMatch = recipeUnit === storeUnit;
        return nameMatch && unitMatch;
      });
      
      if (storeProduct && storeProduct.costPerUnit !== undefined && storeProduct.costPerUnit !== null) {
        const componentCost = qtyPerUnit * storeProduct.costPerUnit * quantity;
        totalCost += componentCost;
      }
    }
    
    return totalCost;
  };

  const generateStockMovementReport = () => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const filtered = stockChecks.filter(check => {
      const checkDate = new Date(check.date);
      return checkDate >= start && checkDate <= end;
    });

    const data: any[] = [];
    
    filtered.forEach(check => {
      const outlet = outlets.find(o => o.name === check.outlet);
      check.counts.forEach(count => {
        const product = products.find(p => p.id === count.productId);
        if (!product) return;

        const sellingPrice = product.sellingPrice || 0;
        const totalValue = sellingPrice * count.quantity;
        const totalCost = calculateProductCost(count.productId, count.quantity);

        data.push({
          'Date': check.date,
          'Outlet': check.outlet || 'N/A',
          'Outlet Type': outlet?.outletType || 'N/A',
          'Product': product.name,
          'Unit': product.unit,
          'Opening Stock': count.openingStock || 0,
          'Received': count.receivedStock || 0,
          'Current Stock': count.quantity || 0,
          'Wastage': count.wastage || 0,
          'Selling Price': sellingPrice || 0,
          'Product Value': totalValue || 0,
          'Total Cost': totalCost || 0,
          'Completed By': check.completedBy || 'N/A',
          'Notes': count.notes || '',
        });
      });
    });

    return data.sort((a, b) => new Date(b['Date']).getTime() - new Date(a['Date']).getTime());
  };

  const generateRequestsReport = () => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const filtered = requests.filter(req => {
      const reqDate = new Date(req.requestDate || req.requestedAt);
      return reqDate >= start && reqDate <= end;
    });

    const data: any[] = [];
    
    filtered.forEach(req => {
      const product = products.find(p => p.id === req.productId);
      if (!product) return;

      const fromOutlet = outlets.find(o => o.name === req.fromOutlet);
      const toOutlet = outlets.find(o => o.name === req.toOutlet);

      const isApproved = req.status === 'approved';
      const sellingPrice = product.sellingPrice || 0;
      const totalValue = isApproved ? sellingPrice * req.quantity : 0;
      const totalCost = isApproved ? calculateProductCost(req.productId, req.quantity) : 0;

      data.push({
        'Date': req.requestDate || new Date(req.requestedAt).toISOString().split('T')[0],
        'Product': product.name,
        'Quantity': req.quantity,
        'From Outlet': req.fromOutlet,
        'From Type': fromOutlet?.outletType || 'N/A',
        'To Outlet': req.toOutlet,
        'To Type': toOutlet?.outletType || 'N/A',
        'Status': req.status,
        'Priority': req.priority,
        'Selling Price': isApproved ? sellingPrice : 0,
        'Product Value': totalValue,
        'Total Cost': totalCost,
        'Requested By': req.requestedBy || 'N/A',
        'Notes': req.notes || '',
      });
    });

    return data.sort((a, b) => new Date(b['Date']).getTime() - new Date(a['Date']).getTime());
  };

  const generateLowStockReport = () => {
    const data: any[] = [];
    
    products.forEach(product => {
      if (product.minStock === undefined) return;
      
      const currentStock = currentStockCounts.get(product.id) || 0;
      if (currentStock < product.minStock) {
        data.push({
          'Product': product.name,
          'Unit': product.unit,
          'Category': product.category || 'N/A',
          'Current Stock': currentStock,
          'Minimum Stock': product.minStock,
          'Shortage': product.minStock - currentStock,
          'Status': currentStock === 0 ? 'Out of Stock' : 'Low Stock',
        });
      }
    });

    return data.sort((a, b) => a['Current Stock'] - b['Current Stock']);
  };

  const generateCustomersReport = () => {
    const data: any[] = [];
    
    customers.forEach(customer => {
      data.push({
        'Name': customer.name,
        'Email': customer.email || 'N/A',
        'Phone': customer.phone || 'N/A',
        'Company': customer.company || 'N/A',
        'Address': customer.address || 'N/A',
        'Created Date': new Date(customer.createdAt).toLocaleDateString(),
        'Total Purchases': customer.totalPurchases || 0,
        'Last Visit': customer.lastVisit ? new Date(customer.lastVisit).toLocaleDateString() : 'N/A',
        'Tags': customer.tags?.join(', ') || 'N/A',
        'Notes': customer.notes || '',
      });
    });

    return data.sort((a, b) => a['Name'].localeCompare(b['Name']));
  };

  const generateProductsReport = () => {
    const data: any[] = [];
    
    products.forEach(product => {
      const currentStock = currentStockCounts.get(product.id) || 0;
      
      data.push({
        'Name': product.name,
        'Type': product.type,
        'Unit': product.unit,
        'Category': product.category || 'N/A',
        'Current Stock': currentStock,
        'Minimum Stock': product.minStock !== undefined ? product.minStock : 'N/A',
        'Show In Stock': product.showInStock ? 'Yes' : 'No',
      });
    });

    return data.sort((a, b) => a['Name'].localeCompare(b['Name']));
  };

  const generateOutletPerformanceReport = () => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const data: any[] = [];

    outlets.forEach(outlet => {
      const stockChecksCount = stockChecks.filter(check => {
        const checkDate = new Date(check.date);
        return check.outlet === outlet.name && checkDate >= start && checkDate <= end;
      }).length;

      const requestsFrom = requests.filter(req => {
        const reqDate = new Date(req.requestDate || req.requestedAt);
        return req.fromOutlet === outlet.name && reqDate >= start && reqDate <= end;
      }).length;

      const requestsTo = requests.filter(req => {
        const reqDate = new Date(req.requestDate || req.requestedAt);
        return req.toOutlet === outlet.name && reqDate >= start && reqDate <= end;
      }).length;

      const approvedRequestsFrom = requests.filter(req => {
        const reqDate = new Date(req.requestDate || req.requestedAt);
        return req.fromOutlet === outlet.name && req.status === 'approved' && reqDate >= start && reqDate <= end;
      }).length;

      const approvedRequestsTo = requests.filter(req => {
        const reqDate = new Date(req.requestDate || req.requestedAt);
        return req.toOutlet === outlet.name && req.status === 'approved' && reqDate >= start && reqDate <= end;
      }).length;

      data.push({
        'Outlet': outlet.name,
        'Type': outlet.outletType || 'N/A',
        'Location': outlet.location || 'N/A',
        'Stock Checks': stockChecksCount,
        'Requests From': requestsFrom,
        'Requests To': requestsTo,
        'Approved From': approvedRequestsFrom,
        'Approved To': approvedRequestsTo,
      });
    });

    return data;
  };

  const generateWastageReport = () => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const filtered = stockChecks.filter(check => {
      const checkDate = new Date(check.date);
      return checkDate >= start && checkDate <= end;
    });

    const data: any[] = [];
    
    filtered.forEach(check => {
      check.counts.forEach(count => {
        if ((count.wastage || 0) > 0) {
          const product = products.find(p => p.id === count.productId);
          if (!product) return;

          const sellingPrice = product.sellingPrice || 0;
          const wastageValue = sellingPrice * (count.wastage || 0);
          const wastageCost = calculateProductCost(count.productId, count.wastage || 0);

          data.push({
            'Date': check.date,
            'Outlet': check.outlet || 'N/A',
            'Product': product.name,
            'Unit': product.unit,
            'Wastage': count.wastage || 0,
            'Selling Price': sellingPrice,
            'Wastage Value': wastageValue,
            'Wastage Cost': wastageCost,
            'Opening Stock': count.openingStock || 0,
            'Received': count.receivedStock || 0,
            'Current Stock': count.quantity || 0,
            'Completed By': check.completedBy || 'N/A',
            'Notes': count.notes || '',
          });
        }
      });
    });

    return data.sort((a, b) => new Date(b['Date']).getTime() - new Date(a['Date']).getTime());
  };

  const generateDiscrepancyAnalysisReport = async () => {
    try {
      setIsGeneratingAnalysis(true);
      
      if (!startDate || !endDate) {
        Alert.alert('Date Range Required', 'Please select start and end dates.');
        setIsGeneratingAnalysis(false);
        return;
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const filteredStockChecks = stockChecks.filter(check => {
        const checkDate = new Date(check.date);
        return checkDate >= start && checkDate <= end;
      });

      const filteredRequests = requests.filter(req => {
        const reqDate = new Date(req.requestDate || req.requestedAt);
        return reqDate >= start && reqDate <= end;
      });

      const outletFilter = selectedOutlet === 'ALL' ? outlets.map(o => o.name) : [selectedOutlet];

      const relevantStockChecks = filteredStockChecks.filter(check => outletFilter.includes(check.outlet || ''));
      const relevantRequests = filteredRequests.filter(req => 
        outletFilter.includes(req.fromOutlet) || outletFilter.includes(req.toOutlet)
      );

      if (relevantStockChecks.length === 0 && relevantRequests.length === 0) {
        Alert.alert('No Data', 'No data found for the selected date range and outlet.');
        setIsGeneratingAnalysis(false);
        return;
      }

      const discrepancies: Array<{
        date: string;
        outlet: string;
        product: string;
        expected: number;
        actual: number;
        difference: number;
        percentage: number;
      }> = [];

      let totalDiscrepancies = 0;
      let significantDiscrepancies = 0;

      relevantStockChecks.forEach(check => {
        check.counts.forEach(count => {
          const product = products.find(p => p.id === count.productId);
          if (!product) return;

          const expected = (count.openingStock || 0) + (count.receivedStock || 0) - (count.wastage || 0);
          const actual = count.quantity || 0;
          const difference = actual - expected;

          if (difference !== 0) {
            totalDiscrepancies++;
            const percentage = expected !== 0 ? (Math.abs(difference) / expected) * 100 : 100;
            
            if (Math.abs(difference) > 5 || percentage > 10) {
              significantDiscrepancies++;
            }

            discrepancies.push({
              date: check.date,
              outlet: check.outlet || 'Unknown',
              product: product.name,
              expected,
              actual,
              difference,
              percentage,
            });
          }
        });
      });

      discrepancies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

      const topDiscrepancies = discrepancies.slice(0, 10);

      const outletSummary: Record<string, { total: number; surplus: number; shortage: number }> = {};
      discrepancies.forEach(d => {
        if (!outletSummary[d.outlet]) {
          outletSummary[d.outlet] = { total: 0, surplus: 0, shortage: 0 };
        }
        outletSummary[d.outlet].total++;
        if (d.difference > 0) {
          outletSummary[d.outlet].surplus++;
        } else {
          outletSummary[d.outlet].shortage++;
        }
      });

      const approvedTransfers = relevantRequests.filter(req => req.status === 'approved');
      const pendingTransfers = relevantRequests.filter(req => req.status === 'pending');

      let report = `DISCREPANCY ANALYSIS REPORT\n`;
      report += `Date Range: ${formatDate(startDate)} to ${formatDate(endDate)}\n`;
      report += `Outlet: ${selectedOutlet}\n\n`;

      report += `=== EXECUTIVE SUMMARY ===\n`;
      report += `Total Stock Checks: ${relevantStockChecks.length}\n`;
      report += `Total Discrepancies Found: ${totalDiscrepancies}\n`;
      report += `Significant Discrepancies: ${significantDiscrepancies}\n`;
      report += `Approved Transfers: ${approvedTransfers.length}\n`;
      report += `Pending Transfers: ${pendingTransfers.length}\n\n`;

      if (topDiscrepancies.length > 0) {
        report += `=== TOP DISCREPANCIES ===\n`;
        topDiscrepancies.forEach((d, i) => {
          const status = d.difference > 0 ? 'SURPLUS' : 'SHORTAGE';
          report += `${i + 1}. ${d.product} at ${d.outlet}\n`;
          report += `   Date: ${d.date}\n`;
          report += `   Expected: ${d.expected.toFixed(2)}, Actual: ${d.actual.toFixed(2)}\n`;
          report += `   ${status}: ${Math.abs(d.difference).toFixed(2)} (${d.percentage.toFixed(1)}%)\n\n`;
        });
      }

      report += `=== OUTLET ANALYSIS ===\n`;
      Object.entries(outletSummary).forEach(([outlet, summary]) => {
        report += `${outlet}:\n`;
        report += `  Total Discrepancies: ${summary.total}\n`;
        report += `  Surplus Cases: ${summary.surplus}\n`;
        report += `  Shortage Cases: ${summary.shortage}\n\n`;
      });

      if (pendingTransfers.length > 0) {
        report += `=== PENDING TRANSFERS ===\n`;
        report += `There are ${pendingTransfers.length} pending transfer requests that may affect stock levels:\n`;
        pendingTransfers.slice(0, 5).forEach(req => {
          const product = products.find(p => p.id === req.productId);
          report += `- ${product?.name || 'Unknown'}: ${req.quantity} from ${req.fromOutlet} to ${req.toOutlet}\n`;
        });
        if (pendingTransfers.length > 5) {
          report += `... and ${pendingTransfers.length - 5} more\n`;
        }
        report += `\n`;
      }

      report += `=== RECOMMENDATIONS ===\n`;
      if (significantDiscrepancies > totalDiscrepancies * 0.3) {
        report += `- HIGH PRIORITY: ${significantDiscrepancies} significant discrepancies detected (>10% or >5 units)\n`;
        report += `  Action: Conduct immediate physical inventory verification\n\n`;
      }
      
      if (pendingTransfers.length > 10) {
        report += `- ${pendingTransfers.length} pending transfers may be causing inaccurate stock counts\n`;
        report += `  Action: Process or cancel pending transfers promptly\n\n`;
      }

      const outletWithMostIssues = Object.entries(outletSummary).sort((a, b) => b[1].total - a[1].total)[0];
      if (outletWithMostIssues) {
        report += `- Outlet "${outletWithMostIssues[0]}" has the most discrepancies (${outletWithMostIssues[1].total})\n`;
        report += `  Action: Review stock counting procedures at this location\n\n`;
      }

      report += `- Implement daily stock checks for high-discrepancy items\n`;
      report += `- Train staff on accurate counting and recording methods\n`;
      report += `- Consider installing cameras in storage areas for shrinkage prevention\n`;

      setAnalysisReport(report);
      setShowAnalysisReport(true);
    } catch (error) {
      console.error('Analysis report error:', error);
      Alert.alert('Error', 'Failed to generate analysis report.');
    } finally {
      setIsGeneratingAnalysis(false);
    }
  };

  const downloadExcelForAiReport = async () => {
    try {
      setIsGenerating(true);
      
      if (!startDate || !endDate) {
        Alert.alert('Date Range Required', 'Please select start and end dates for this report.');
        return;
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const filteredStockChecks = stockChecks.filter(check => {
        const checkDate = new Date(check.date);
        return checkDate >= start && checkDate <= end;
      });

      const filteredRequests = requests.filter(req => {
        const reqDate = new Date(req.requestDate || req.requestedAt);
        return reqDate >= start && reqDate <= end;
      });

      const outletFilter = selectedOutlet === 'ALL' ? outlets.map(o => o.name) : [selectedOutlet];

      const relevantStockChecks = filteredStockChecks.filter(check => outletFilter.includes(check.outlet || ''));
      const relevantRequests = filteredRequests.filter(req => 
        outletFilter.includes(req.fromOutlet) || outletFilter.includes(req.toOutlet)
      );

      const data: any[] = [];

      relevantStockChecks.forEach(check => {
        const outlet = outlets.find(o => o.name === check.outlet);
        check.counts.forEach(count => {
          const product = products.find(p => p.id === count.productId);
          if (!product) return;

          const expected = (count.openingStock || 0) + (count.receivedStock || 0) - (count.wastage || 0);
          const discrepancy = count.quantity - expected;

          data.push({
            'Date': check.date,
            'Outlet': check.outlet || 'N/A',
            'Outlet Type': outlet?.outletType || 'N/A',
            'Product': product.name,
            'Unit': product.unit,
            'Opening Stock': count.openingStock || 0,
            'Received': count.receivedStock || 0,
            'Wastage': count.wastage || 0,
            'Expected Closing': expected,
            'Actual Closing': count.quantity || 0,
            'Discrepancy': discrepancy,
            'Status': discrepancy === 0 ? 'Match' : (discrepancy > 0 ? 'Surplus' : 'Shortage'),
            'Notes': count.notes || '',
          });
        });
      });

      if (data.length === 0) {
        Alert.alert('No Data', 'No data available for the selected criteria.');
        return;
      }

      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Discrepancy Analysis');
      
      const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

      const fileName = `ai_discrepancy_${selectedOutlet}_${startDate}_to_${endDate}.xlsx`;

      if (Platform.OS === 'web') {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        
        setTimeout(() => {
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
          URL.revokeObjectURL(url);
        }, 100);
        
        Alert.alert('Success', 'Report downloaded successfully.');
      } else {
        if (!FileSystem.documentDirectory) {
          Alert.alert('Error', 'File system not available.');
          return;
        }
        
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Save Report',
            UTI: 'com.microsoft.excel.xlsx',
          });
        } else {
          Alert.alert('Success', 'Report exported to app directory.');
        }
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to generate report.');
    } finally {
      setIsGenerating(false);
    }
  };

  const generateReport = (type: ReportType): any[] => {
    switch (type) {
      case 'inventory':
        return generateInventoryReport();
      case 'stockMovement':
        return generateStockMovementReport();
      case 'requests':
        return generateRequestsReport();
      case 'lowStock':
        return generateLowStockReport();
      case 'customers':
        return generateCustomersReport();
      case 'products':
        return generateProductsReport();
      case 'outletPerformance':
        return generateOutletPerformanceReport();
      case 'wastage':
        return generateWastageReport();
      case 'aiDiscrepancy':
        return [];
      default:
        return [];
    }
  };

  const downloadExcel = async (type: ReportType) => {
    try {
      setIsGenerating(true);
      
      if (type === 'aiDiscrepancy') {
        await generateDiscrepancyAnalysisReport();
        setIsGenerating(false);
        return;
      }
      
      const reportOption = REPORT_OPTIONS.find(r => r.id === type);
      if (!reportOption) return;

      if (reportOption.requiresDateRange && (!startDate || !endDate)) {
        Alert.alert('Date Range Required', 'Please select start and end dates for this report.');
        return;
      }

      const data = generateReport(type);
      
      if (data.length === 0) {
        Alert.alert('No Data', 'No data available for this report.');
        return;
      }

      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, reportOption.title);
      
      const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

      const dateRangeSuffix = reportOption.requiresDateRange
        ? `_${startDate}_to_${endDate}`
        : `_${new Date().toISOString().split('T')[0]}`;
      const fileName = `${type}_report${dateRangeSuffix}.xlsx`;

      if (Platform.OS === 'web') {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        
        setTimeout(() => {
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
          URL.revokeObjectURL(url);
        }, 100);
        
        Alert.alert('Success', 'Report downloaded successfully.');
      } else {
        if (!FileSystem.documentDirectory) {
          Alert.alert('Error', 'File system not available.');
          return;
        }
        
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Save Report',
            UTI: 'com.microsoft.excel.xlsx',
          });
        } else {
          Alert.alert('Success', 'Report exported to app directory.');
        }
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to generate report.');
    } finally {
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  return (
    <>
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Reports</Text>
          <Text style={styles.headerSubtitle}>
            Generate and download reports in Excel format
          </Text>
        </View>

        <View style={styles.dateRangeSection}>
          <Text style={styles.sectionTitle}>Date Range (for applicable reports)</Text>
          <View style={styles.dateRangeContainer}>
            <View style={styles.dateInputContainer}>
              <Text style={styles.dateLabel}>Start Date</Text>
              <TouchableOpacity
                style={styles.dateButton}
                onPress={() => setShowStartCalendar(true)}
              >
                <Calendar size={20} color={Colors.light.tint} />
                <Text style={styles.dateButtonText}>
                  {startDate ? formatDate(startDate) : 'Select Date'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dateInputContainer}>
              <Text style={styles.dateLabel}>End Date</Text>
              <TouchableOpacity
                style={styles.dateButton}
                onPress={() => setShowEndCalendar(true)}
              >
                <Calendar size={20} color={Colors.light.tint} />
                <Text style={styles.dateButtonText}>
                  {endDate ? formatDate(endDate) : 'Select Date'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.reportsSection}>
          <Text style={styles.sectionTitle}>Available Reports</Text>
          {REPORT_OPTIONS.map((report) => (
            <View key={report.id} style={styles.reportCard}>
              <View style={styles.reportInfo}>
                {report.id === 'aiDiscrepancy' ? (
                  <AlertTriangle size={24} color={Colors.light.tint} />
                ) : (
                  <FileText size={24} color={Colors.light.tint} />
                )}
                <View style={styles.reportText}>
                  <Text style={styles.reportTitle}>{report.title}</Text>
                  <Text style={styles.reportDescription}>{report.description}</Text>
                  {report.requiresDateRange && (
                    <Text style={styles.requiresDateText}>Requires date range</Text>
                  )}
                  {report.id === 'aiDiscrepancy' && (
                    <View style={styles.outletPickerContainer}>
                      <Text style={styles.outletPickerLabel}>Outlet:</Text>
                      <View style={styles.outletPickerButtons}>
                        <TouchableOpacity
                          style={[styles.outletButton, selectedOutlet === 'ALL' && styles.outletButtonActive]}
                          onPress={() => setSelectedOutlet('ALL')}
                        >
                          <Text style={[styles.outletButtonText, selectedOutlet === 'ALL' && styles.outletButtonTextActive]}>All</Text>
                        </TouchableOpacity>
                        {outlets.map(outlet => (
                          <TouchableOpacity
                            key={outlet.id}
                            style={[styles.outletButton, selectedOutlet === outlet.name && styles.outletButtonActive]}
                            onPress={() => setSelectedOutlet(outlet.name)}
                          >
                            <Text style={[styles.outletButtonText, selectedOutlet === outlet.name && styles.outletButtonTextActive]}>
                              {outlet.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              </View>
              {report.id === 'aiDiscrepancy' ? (
                <View style={styles.aiButtonGroup}>
                  <TouchableOpacity
                    style={[styles.downloadButton, (isGenerating || isGeneratingAnalysis) && styles.downloadButtonDisabled]}
                    onPress={() => downloadExcel(report.id)}
                    disabled={isGenerating || isGeneratingAnalysis}
                  >
                    {isGeneratingAnalysis ? (
                      <ActivityIndicator size="small" color={Colors.light.card} />
                    ) : (
                      <>
                        <AlertTriangle size={20} color={Colors.light.card} />
                        <Text style={styles.downloadButtonText}>Analyze</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.downloadButtonSecondary, isGenerating && styles.downloadButtonDisabled]}
                    onPress={downloadExcelForAiReport}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <ActivityIndicator size="small" color={Colors.light.tint} />
                    ) : (
                      <>
                        <Download size={18} color={Colors.light.tint} />
                        <Text style={styles.downloadButtonSecondaryText}>Excel</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.downloadButton, isGenerating && styles.downloadButtonDisabled]}
                  onPress={() => downloadExcel(report.id)}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <ActivityIndicator size="small" color={Colors.light.card} />
                  ) : (
                    <>
                      <Download size={20} color={Colors.light.card} />
                      <Text style={styles.downloadButtonText}>Excel</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>

      <CalendarModal
        visible={showStartCalendar}
        onClose={() => setShowStartCalendar(false)}
        onSelect={(date: string) => {
          setStartDate(date);
          setShowStartCalendar(false);
        }}
        initialDate={startDate}
      />

      <CalendarModal
        visible={showEndCalendar}
        onClose={() => setShowEndCalendar(false)}
        onSelect={(date: string) => {
          setEndDate(date);
          setShowEndCalendar(false);
        }}
        initialDate={endDate}
      />

      {showAnalysisReport && (
        <Modal
          visible={showAnalysisReport}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAnalysisReport(false)}
        >
          <View style={styles.aiReportModal}>
            <View style={styles.aiReportContainer}>
              <View style={styles.aiReportHeader}>
                <Text style={styles.aiReportTitle}>Discrepancy Analysis</Text>
                <View style={styles.aiReportHeaderButtons}>
                  <TouchableOpacity
                    style={styles.aiReportCloseButton}
                    onPress={() => setShowAnalysisReport(false)}
                  >
                    <Text style={styles.aiReportCloseButtonText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <ScrollView style={styles.aiReportContent}>
                <Text style={styles.aiReportText}>{analysisReport}</Text>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
  },
  header: {
    padding: 20,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: Colors.light.muted,
  },
  dateRangeSection: {
    padding: 20,
    backgroundColor: Colors.light.card,
    marginTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 12,
  },
  dateRangeContainer: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  dateInputContainer: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  dateButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 12,
  },
  dateButtonText: {
    fontSize: 14,
    color: Colors.light.text,
  },
  reportsSection: {
    padding: 20,
  },
  reportCard: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  reportInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    flex: 1,
  },
  reportText: {
    flex: 1,
  },
  reportTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  reportDescription: {
    fontSize: 13,
    color: Colors.light.muted,
  },
  requiresDateText: {
    fontSize: 12,
    color: Colors.light.warning || '#FF9500',
    marginTop: 4,
    fontStyle: 'italic' as const,
  },
  downloadButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  downloadButtonDisabled: {
    opacity: 0.6,
  },
  downloadButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.card,
  },
  bottomPadding: {
    height: 20,
  },
  outletPickerContainer: {
    marginTop: 8,
  },
  outletPickerLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 6,
  },
  outletPickerButtons: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  outletButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  outletButtonActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  outletButtonText: {
    fontSize: 12,
    color: Colors.light.text,
    fontWeight: '500' as const,
  },
  outletButtonTextActive: {
    color: Colors.light.card,
  },
  aiReportModal: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 20,
  },
  aiReportContainer: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    width: '100%',
    maxWidth: 600,
    maxHeight: '80%',
    overflow: 'hidden' as const,
  },
  aiReportHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  aiReportTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  aiReportHeaderButtons: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  aiReportCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.light.background,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  aiReportCloseButtonText: {
    fontSize: 18,
    color: Colors.light.text,
    fontWeight: '600' as const,
  },
  aiReportContent: {
    padding: 16,
  },
  aiReportText: {
    fontSize: 14,
    lineHeight: 22,
    color: Colors.light.text,
  },
  aiButtonGroup: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  downloadButtonSecondary: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  downloadButtonSecondaryText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  progressModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 20,
  },
  progressModalContent: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    minHeight: 200,
    justifyContent: 'center' as const,
  },
  progressModalTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 16,
    textAlign: 'center' as const,
  },
  progressMessage: {
    fontSize: 14,
    color: Colors.light.text,
    textAlign: 'center' as const,
    marginTop: 8,
  },
  progressError: {
    fontSize: 14,
    color: '#f44336',
    textAlign: 'center' as const,
    marginBottom: 16,
  },
  progressHint: {
    fontSize: 12,
    color: Colors.light.muted,
    textAlign: 'center' as const,
    marginTop: 8,
    fontStyle: 'italic' as const,
  },
  progressCloseButton: {
    backgroundColor: Colors.light.tint,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignSelf: 'center' as const,
    marginTop: 8,
  },
  progressCloseButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.card,
  },
});
