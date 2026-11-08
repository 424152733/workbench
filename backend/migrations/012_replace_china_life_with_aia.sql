-- Keep historical China Life products and sync events intact, but remove it from
-- the active company picker and disable future sync attempts.
UPDATE product_company_dictionary
SET is_active=FALSE,
    sync_enabled=FALSE,
    sync_supported=FALSE,
    sort_order=999,
    sync_coverage='已停止同步配置，历史产品档案保留'
WHERE code='china-life';

INSERT INTO product_company_dictionary(code,label,is_active,sort_order,adapter_code,sync_supported,sync_enabled,sync_coverage)
VALUES ('aia-life','友邦人寿',TRUE,20,'aia-life',TRUE,TRUE,'个人寿险、健康险、意外险、年金险')
ON CONFLICT(code) DO UPDATE SET
  label=EXCLUDED.label,
  is_active=TRUE,
  sort_order=EXCLUDED.sort_order,
  adapter_code=EXCLUDED.adapter_code,
  sync_supported=EXCLUDED.sync_supported,
  sync_enabled=EXCLUDED.sync_enabled,
  sync_coverage=EXCLUDED.sync_coverage;
