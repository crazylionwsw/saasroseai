export interface Env {
  MERCHANT_DB: D1Database;
  ASSETS: R2Bucket;
  RECORDINGS: R2Bucket;
  KNOWLEDGE: VectorizeIndex;
  MERCHANT_ID: string;
  MERCHANT_TOKEN: string;
  CENTRAL_AUTH_URL: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_CLIENT_ID?: string;
  SQUARE_ACCESS_TOKEN?: string;
  SQUARE_LOCATION_ID?: string;
  SQUARE_WEBHOOK_SIGNATURE_KEY?: string;
  SQUARE_CLIENT_ID?: string;
  SQUARE_CLIENT_SECRET?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  AI: Ai;
  CHAT_ROOM_DO: DurableObjectNamespace;
  PHONE_CALL_DO: DurableObjectNamespace;
  ORDER_NOTIFY_DO: DurableObjectNamespace;
  translations?: { get: (key: string) => Promise<R2ObjectBody | null> };
}

export interface MenuItem {
  id: string; name: string; description: string;
  price: number; image: string; category: string;
  tags: string[]; isAvailable: boolean;
  vegetarian?: boolean;
  vegan?: boolean;
  spicyLevel?: number;
  allergens?: string[];
  specifications?: { name: string; options: { label: string; priceDelta: number }[] }[];
}

export interface MenuCategory { name: string; items: MenuItem[] }

export type OrderStatus =
  | 'draft' | 'pending_payment' | 'paid' | 'confirmed' | 'preparing'
  | 'ready' | 'completed' | 'cancelled' | 'refunded'

export type PaymentStatus =
  | 'not_required' | 'pending' | 'processing' | 'succeeded' | 'failed'
  | 'cancelled' | 'refunded' | 'partially_refunded'

export type OrderType = 'dine_in' | 'pickup'

export interface Order {
  id: string;
  merchantId: string;
  orderNumber?: string;
  orderType: OrderType;
  tableId?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  items: string;
  subtotal: number;
  deliveryFee?: number;
  discount?: number;
  total: number;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  currency: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: string;
  paymentId?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  merchantId: string;
  orderId: string;
  provider: string;
  providerPaymentId?: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  metadata?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentEvent {
  id: string;
  merchantId: string;
  provider: string;
  providerEventId: string;
  type: string;
  data?: string;
  processedAt: string;
}

export interface CartLineRequest {
  id: string | number;
  qty: number;
  modifiers?: string[];
}

export interface CalculatedLine {
  id: string;
  name: string;
  qty: number;
  priceCents: number;
  lineCents: number;
}

export interface PriceQuote {
  lines: CalculatedLine[];
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  currency: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  providerPaymentId: string;
}

export interface PaymentResult {
  providerPaymentId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  checkoutUrl?: string;
}

export interface RefundResult {
  providerRefundId: string;
  amountCents: number;
}

export interface WebhookEvent {
  providerEventId: string;
  type: string;
  data: any;
}

export interface PaymentProvider {
  createCheckout(params: {
    orderId: string;
    merchantId: string;
    amountCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    connectedAccountId?: string;
  }): Promise<CheckoutResult>;
  getPayment(providerPaymentId: string): Promise<PaymentResult>;
  refund(providerPaymentId: string, amountCents: number, reason?: string): Promise<RefundResult>;
  verifyWebhook(request: Request): Promise<WebhookEvent>;
}

export interface MerchantInfo {
  id: string; name: string; slogan?: string; description?: string;
  logoUrl?: string; coverUrl?: string; primaryColor: string;
  templateId: string; phone?: string; address?: string;
  businessHours?: string; latitude?: number; longitude?: number;
  socialMedia?: string;
  enableOrdering: number; enablePayment: number;
  enableChat: number; enablePhone: number;
  language?: string;
  currencySymbol?: string;
}

export interface Message {
  id: string; role: 'customer' | 'ai' | 'agent' | 'system';
  content: string; timestamp: number; metadata?: string;
}

export interface D1MerchantInfo extends MerchantInfo {
  menuCategories?: string;
  featuredItems?: string;
}

export interface AuthResult {
  merchantId: string;
  status: string;
  plan: string;
}
