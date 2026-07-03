export interface Merchant {
  id: string; name: string; email?: string; phone?: string;
  status: 'active' | 'frozen' | 'expired' | 'deleted';
  plan: 'basic' | 'pro' | 'enterprise';
  cfAccountEmail?: string; cfAccountId?: string;
  subdomain?: string; templateId: string;
  themeColor: string; createdAt: string; expiresAt?: string; notes?: string;
}

export interface MerchantConfig {
  merchantId: string;
  driveTokenEncrypted?: string; driveFolderId?: string;
  twilioPhoneSid?: string; twilioAuthTokenEncrypted?: string;
  stripeAccountId?: string; wechatMerchantId?: string; alipayMerchantId?: string;
  customDomain?: string; sslStatus: string;
}

export interface Deployment {
  id: string; merchantId: string; version: string;
  templateVersion?: string; status: 'pending' | 'deploying' | 'success' | 'failed';
  workerUrl?: string; pagesUrl?: string; cfDeploymentId?: string;
  startedAt: string; completedAt?: string; errorLog?: string; deployedBy?: string;
}

export interface Template {
  id: string; name: string; description?: string;
  previewUrl?: string; isActive: number; createdAt: string; features?: string;
}

export interface Env {
  CENTRAL_DB: D1Database;
  TEMPLATES_R2: R2Bucket;
  JWT_SECRET: string;
  ADMIN_API_TOKEN: string;
  AI?: Ai;
}

export interface VerifyResponse {
  status: 'active' | 'frozen' | 'expired';
  merchantId: string;
  plan: string;
}
