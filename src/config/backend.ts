function toBool(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

const rawBaseUrl = (process.env.EXPO_PUBLIC_BACKEND_API_URL ?? '').trim();

export const BACKEND_API_BASE_URL = rawBaseUrl.replace(/\/+$/, '');
export const BACKEND_API_ENABLED =
  toBool(process.env.EXPO_PUBLIC_ENABLE_VPS_BACKEND) &&
  BACKEND_API_BASE_URL.length > 0;
