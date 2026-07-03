export interface Env {
  MERCHANT_DB: D1Database;
  ASSETS: R2Bucket;
  RECORDINGS: R2Bucket;
  KNOWLEDGE: VectorizeIndex;
  MERCHANT_ID: string;
  MERCHANT_TOKEN: string;
  CENTRAL_AUTH_URL: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  AI: Ai;
}

export interface MenuItem {
  id: string; name: string; description: string;
  price: number; image: string; category: string;
  tags: string[]; isAvailable: boolean;
  specifications?: { name: string; options: { label: string; priceDelta: number }[] }[];
}

export interface MenuCategory { name: string; items: MenuItem[] }

export interface Order {
  id: string; merchantId: string;
  customerName?: string; customerPhone?: string; customerAddress?: string;
  items: string; subtotal: number; deliveryFee?: number;
  discount?: number; total: number;
  status: 'pending' | 'confirmed' | 'preparing' | 'delivering' | 'completed' | 'cancelled';
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  paymentMethod?: string; paymentId?: string; note?: string;
  createdAt: string; updatedAt: string;
}

export interface MerchantInfo {
  id: string; name: string; slogan?: string; description?: string;
  logoUrl?: string; coverUrl?: string; primaryColor: string;
  templateId: string; phone?: string; address?: string;
  businessHours?: string; latitude?: number; longitude?: number;
  socialMedia?: string;
  enableOrdering: number; enablePayment: number;
  enableChat: number; enablePhone: number;
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
