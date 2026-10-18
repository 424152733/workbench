ALTER TABLE product_copy_drafts
  ADD COLUMN platform_settings_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 财险产品在首期由人保财险档案承接；首期只开放新华保险档案时隐藏该选项。
UPDATE product_insurance_type_dictionary SET is_active=FALSE WHERE code='property';
