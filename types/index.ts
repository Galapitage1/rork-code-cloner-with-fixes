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

export interface LinkedProductComponent {
  kitchenProductId: string;
  quantityPerMenuUnit: number;
}

export interface LinkedProductMapping {
  id: string;
  menuProductId: string;
  components: LinkedProductComponent[];
  updatedAt?: number;
  deviceId?: string;
  deleted?: boolean;
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
  status: 'pending' | 'approved' | 'fulfilled' | 'rejected';
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
  idNumber?: string;
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
  prodsReqUpdates?: {
    productId: string;
    prodsReqWhole: number;
    prodsReqSlices: number;
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

// Live Inventory Snapshot - captures the state of inventory at a point in time
// This is used to preserve inventory data even if source data (stock checks, transfers) is deleted
export interface LiveInventorySnapshotItem {
  productId: string;
  // Production/Kitchen stock
  productionWhole: number;
  productionSlices: number;
  // Production request column
  prodsReqWhole: number;
  prodsReqSlices: number;
  // Per-outlet stocks
  outletStocks: {
    outletName: string;
    whole: number;
    slices: number;
    // Tracked values for live inventory display
    openingWhole: number;
    openingSlices: number;
    receivedWhole: number;
    receivedSlices: number;
    soldWhole: number;
    soldSlices: number;
    wastageWhole: number;
    wastageSlices: number;
  }[];
}

export interface LiveInventorySnapshot {
  id: string;
  date: string; // YYYY-MM-DD format
  items: LiveInventorySnapshotItem[];
  // Metadata about what triggered this snapshot
  triggeredBy: 'transfer_approved' | 'stock_check' | 'sales_reconciliation' | 'manual' | 'system';
  triggerDetails?: string; // e.g., "Transfer #123 approved" or "Stock check for Outlet A"
  createdAt: number;
  updatedAt: number;
  deviceId?: string;
  deleted?: boolean;
}

export interface SMSProviderSettings {
  id: string;
  provider: 'dialog_esms';
  esms_username: string;
  esms_password_encrypted: string;
  default_source_address?: string;
  default_payment_method: 0 | 4;
  push_notification_url?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  deviceId?: string;
}

export interface SMSAuthToken {
  id: string;
  provider_settings_id: string;
  access_token: string;
  expires_at: number;
  last_refresh_at: number;
  status: 'active' | 'expired' | 'invalid';
  createdAt: number;
  updatedAt: number;
}

export type SMSCampaignStatus = 'pending' | 'sending' | 'completed' | 'running' | 'failed';

export interface SMSCampaign {
  id: string;
  provider_settings_id: string;
  transaction_id: number;
  message: string;
  source_address?: string;
  payment_method: 0 | 4;
  recipient_count: number;
  campaign_id?: string;
  campaign_cost?: number;
  wallet_balance?: number;
  duplicates_removed?: number;
  invalid_numbers?: number;
  mask_blocked_numbers?: number;
  status: SMSCampaignStatus;
  comment?: string;
  errCode?: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  deleted?: boolean;
  deviceId?: string;
}

export type SMSDeliveryStatus = 'submitted' | 'submission_failed' | 'delivered' | 'delivery_failed' | 'pending';

export interface SMSRecipient {
  id: string;
  campaign_id: string;
  mobile_original: string;
  mobile_normalized: string;
  delivery_status: SMSDeliveryStatus;
  last_status_code?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SMSDeliveryEvent {
  id: string;
  campaign_id: string;
  msisdn: string;
  status_code: number;
  raw_querystring: string;
  received_at: number;
}

export interface LeaveType {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  deviceId?: string;
}

export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected';

export interface LeaveRequest {
  id: string;
  employeeName: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason?: string;
  status: LeaveRequestStatus;
  reviewedBy?: string;
  reviewedAt?: number;
  reviewNotes?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  deleted?: boolean;
  deviceId?: string;
}
