export type ProductType = 'menu' | 'raw' | 'kitchen';

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  unit: string;
  category?: string;
  minStock?: number;
  imageUri?: string;
  showInStock?: boolean;
  salesBasedRawCalc?: boolean;
  sellingPrice?: number;
  updatedAt?: number;
  deviceId?: string;
  deleted?: boolean;
}

export interface RecipeComponent {
  rawProductId: string;
  quantityPerUnit: number;
}

export interface Recipe {
  id: string;
  menuProductId: string;
  components: RecipeComponent[];
  updatedAt?: number;
  deviceId?: string;
}

export interface StockCount {
  productId: string;
  quantity: number;
  openingStock?: number;
  receivedStock?: number;
  wastage?: number;
  notes?: string;
  autoFilledReceivedFromProdReq?: number;
  manuallyEditedDate?: string;
  sellingPrice?: number;
  totalValue?: number;
  totalCost?: number;
}

export interface StockCheck {
  id: string;
  date: string;
  timestamp: number;
  counts: StockCount[];
  completedBy?: string;
  outlet?: string;
  doneDate?: string;
  replaceAllInventory?: boolean;
  updatedAt?: number;
  deviceId?: string;
  deleted?: boolean;
}

export interface ProductRequest {
  id: string;
  productId: string;
  quantity: number;
  wastage?: number;
  priority: 'low' | 'medium' | 'high';
  notes?: string;
  requestedBy?: string;
  requestedAt: number;
  status: 'pending' | 'approved' | 'fulfilled';
  fromOutlet: string;
  toOutlet: string;
  requestDate?: string;
  doneDate?: string;
  sellingPrice?: number;
  totalValue?: number;
  totalCost?: number;
  updatedAt?: number;
  deviceId?: string;
  deleted?: boolean;
}

export interface DailyReport {
  date: string;
  stockCheck?: StockCheck;
  requests: ProductRequest[];
  lowStockItems: {
    product: Product;
    currentStock: number;
    minStock: number;
  }[];
}

export interface Outlet {
  id: string;
  name: string;
  location?: string;
  outletType?: 'sales' | 'production';
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  deleted?: boolean;
}

export type UserRole = 'superadmin' | 'admin' | 'user';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  deleted?: boolean;
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  notes?: string;
  points?: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  totalPurchases?: number;
  lastVisit?: number;
  tags?: string[];
  deleted?: boolean;
  deviceId?: string;
}

export interface ProductConversion {
  id: string;
  fromProductId: string;
  toProductId: string;
  conversionFactor: number;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  deleted?: boolean;
}

export interface InventoryStock {
  id: string;
  productId: string;
  productionWhole: number;
  productionSlices: number;
  prodsWhole?: number;
  prodsSlices?: number;
  prodsReqWhole?: number;
  prodsReqSlices?: number;
  productionRequest?: number;
  outletStocks: {
    outletName: string;
    whole: number;
    slices: number;
  }[];
  updatedAt: number;
  deviceId?: string;
  deleted?: boolean;
}

export interface SalesDeduction {
  id: string;
  outletName: string;
  productId: string;
  salesDate: string;
  loadDate: string;
  wholeDeducted: number;
  slicesDeducted: number;
  updatedAt: number;
  deviceId?: string;
  deleted?: boolean;
}

export interface SalesReconciliationHistory {
  id: string;
  date: string;
  outlet: string;
  salesData: {
    productId: string;
    sold: number;
    opening: number;
    received: number;
    closing: number;
  }[];
  stockCheckData: {
    productId: string;
    openingStock: number;
    receivedStock: number;
    wastage: number;
    closingStock: number;
  }[];
  rawConsumption?: {
    rawProductId: string;
    consumed: number;
  }[];
  timestamp: number;
  updatedAt?: number;
  deviceId?: string;
  deleted?: boolean;
}

export interface OrderProduct {
  productId: string;
  quantity: number;
  unit: string;
}

export type DeliveryMethod = 'deliver' | 'collection';
export type OrderReceivedFrom = 'at_outlet' | 'on_phone' | 'via_website' | 'ubereats' | 'pickme' | 'other';

export interface CustomerOrder {
  id: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress?: string;
  products: OrderProduct[];
  orderDate: string;
  orderTime: string;
  deliveryMethod: DeliveryMethod;
  deliveryAddress?: string;
  collectionOutlet?: string;
  outlet: string;
  orderReceivedFrom?: OrderReceivedFrom;
  orderReceivedFromOther?: string;
  status: 'active' | 'fulfilled';
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  fulfilledAt?: number;
  fulfilledBy?: string;
  notes?: string;
  deleted?: boolean;
  deviceId?: string;
}

export interface StoreProduct {
  id: string;
  name: string;
  unit: string;
  category: string;
  quantity: number;
  minStockLevel: number;
  costPerUnit?: number;
  supplierId?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  deleted?: boolean;
  deviceId?: string;
}

export interface Supplier {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  contactPerson?: string;
  contactPersonPhone?: string;
  contactPersonEmail?: string;
  vatNumber?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  deleted?: boolean;
  deviceId?: string;
}

export interface GRNItem {
  storeProductId: string;
  quantity: number;
  costPerUnit?: number;
}

export interface GRN {
  id: string;
  supplierId: string;
  invoiceNumber: string;
  invoiceAmount: number;
  vatAmount: number;
  discountAmount: number;
  items: GRNItem[];
  dueDate: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  deleted?: boolean;
  deviceId?: string;
}

export interface ProductionRequestItem {
  productId: string;
  quantity: number;
}

export interface ProductionRequest {
  id: string;
  date: string;
  requestedBy: string;
  items: ProductionRequestItem[];
  status: 'pending' | 'approved';
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  deleted?: boolean;
  deviceId?: string;
}

export interface ApprovedProductionItem {
  productId: string;
  productName: string;
  requestedQuantity: number;
  totalCost?: number;
  ingredients: {
    rawProductId: string;
    rawProductName: string;
    quantity: number;
    costPerUnit?: number;
    totalCost?: number;
  }[];
}

export interface ApprovedProduction {
  id: string;
  requestId: string;
  date: string;
  requestedBy: string;
  items: ApprovedProductionItem[];
  approvalDate: string;
  approvedAt: number;
  approvedBy: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  deviceId?: string;
}

export type ActivityType = 
  | 'stock_check' 
  | 'stock_sent' 
  | 'stock_received' 
  | 'reconciliation' 
  | 'inventory_edit' 
  | 'production_request' 
  | 'production_approved'
  | 'order_created'
  | 'order_fulfilled'
  | 'grn_created'
  | 'requests_approved';

export interface ActivityLog {
  id: string;
  type: ActivityType;
  date: string;
  time: string;
  outlet: string;
  username: string;
  userId: string;
  description: string;
  metadata?: Record<string, any>;
  createdAt: number;
  deleted?: boolean;
  deviceId?: string;
}

export interface ProductTrackerMovement {
  productId: string;
  productName: string;
  unit: string;
  hasConversion: boolean;
  openingWhole: number;
  openingSlices: number;
  receivedWhole: number;
  receivedSlices: number;
  wastageWhole: number;
  wastageSlices: number;
  soldWhole: number;
  soldSlices: number;
  currentWhole: number;
  currentSlices: number;
  discrepancyWhole: number;
  discrepancySlices: number;
}

export interface ProductTrackerData {
  outlet: string;
  date: string;
  movements: ProductTrackerMovement[];
  timestamp: number;
}

export interface ProductTrackerSnapshot {
  id: string;
  outlet: string;
  startDate: string;
  endDate: string;
  data: ProductTrackerData[];
  updatedAt: number;
  deviceId?: string;
  deleted?: boolean;
}
