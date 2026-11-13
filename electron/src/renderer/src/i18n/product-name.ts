import { withProductName } from '../../../../../config/product-name.mjs';

export { withProductName };

export const productNamePostProcessor = {
  type: 'postProcessor' as const,
  name: 'productName',
  process: (value: string, key: string | string[]) => withProductName(value, key),
};
