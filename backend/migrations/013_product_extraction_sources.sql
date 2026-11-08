DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='product_documents_product_id_id_key') THEN
    ALTER TABLE product_documents ADD CONSTRAINT product_documents_product_id_id_key UNIQUE(product_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='product_extractions_product_id_id_key') THEN
    ALTER TABLE product_extractions ADD CONSTRAINT product_extractions_product_id_id_key UNIQUE(product_id,id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS product_extraction_documents (
  product_id BIGINT NOT NULL,
  extraction_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(extraction_id,document_id),
  FOREIGN KEY(product_id,extraction_id) REFERENCES product_extractions(product_id,id) ON DELETE CASCADE,
  FOREIGN KEY(product_id,document_id) REFERENCES product_documents(product_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS product_extraction_documents_document_idx
  ON product_extraction_documents(document_id,extraction_id);

INSERT INTO product_extraction_documents(product_id,extraction_id,document_id,sort_order)
SELECT product_id,id,document_id,0 FROM product_extractions
ON CONFLICT(extraction_id,document_id) DO NOTHING;
