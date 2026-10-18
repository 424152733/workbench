import { BadRequestException, NotFoundException } from '@nestjs/common';
import { STAGES, beijingDate, strictDate } from './workbench-primitives.js';

const WINDOW_DAYS = 90;
const LEAD_KIND = '新线索';
const EXISTING_KIND = '已有客户';
const rate = (count, denominator) => denominator ? Math.round((1000 * count) / denominator) / 10 : null;
const number = (value) => Number(value || 0);

function defaultFromDate(to) {
  const [year, month] = to.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1 - 11, 1));
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function analyticsAsOfText(date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().replace('Z', '+08:00');
}

function assertRange(from, to) {
  if (from > to) throw new BadRequestException('开始日期不能晚于结束日期');
  const latestStart = new Date(`${to}T00:00:00.000Z`);
  latestStart.setUTCMonth(latestStart.getUTCMonth() - 24);
  if (new Date(`${from}T00:00:00.000Z`) < latestStart) {
    throw new BadRequestException('查询范围不能超过 24 个月');
  }
}

export class CustomerAnalyticsOperations {
  async customerAcquisitionSources() {
    const { rows } = await this.db.query(`SELECT sd.code,sd.label
      FROM source_dictionary sd
      WHERE sd.active=true OR EXISTS (SELECT 1 FROM customer_acquisition ca WHERE ca.source_code=sd.code)
      ORDER BY sd.sort_order,sd.label,sd.code`);
    return rows;
  }

  async customerAnalytics({ from: fromInput, to: toInput, sourceCode: sourceInput = '' } = {}) {
    const to = strictDate(toInput || beijingDate(), '结束日期');
    const from = strictDate(fromInput || defaultFromDate(to), '开始日期');
    if (to > beijingDate()) throw new BadRequestException('结束日期不能晚于今天');
    assertRange(from, to);
    const sourceCode = String(sourceInput || '').trim() || null;
    return this.db.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const asOfResult = await client.query('SELECT statement_timestamp() AS as_of');
      const asOf = new Date(asOfResult.rows[0].as_of);
      const asOfText = analyticsAsOfText(asOf);
      const sourceResult = await client.query(`SELECT sd.code FROM source_dictionary sd
        WHERE sd.code=$1 AND (sd.active=true OR EXISTS (SELECT 1 FROM customer_acquisition ca WHERE ca.source_code=sd.code))`, [sourceCode]);
      if (sourceCode && !sourceResult.rowCount) throw new BadRequestException('获客来源无效或已无历史记录');

      const [optionsResult, aggregateResult] = await Promise.all([
        client.query(`SELECT sd.code,sd.label FROM source_dictionary sd
          WHERE sd.active=true OR EXISTS (SELECT 1 FROM customer_acquisition ca WHERE ca.source_code=sd.code)
          ORDER BY sd.sort_order,sd.label,sd.code`),
        client.query(`WITH scoped AS (
            SELECT c.id,c.stage,c.created_at,
              COALESCE(ca.initial_kind,c.kind) AS initial_kind,
              COALESCE(ca.source_code,c.source_code) AS acquisition_source_code,
              sd.label AS acquisition_source_label,ca.basis,
              (c.created_at + INTERVAL '90 days' <= $3::timestamptz) AS mature,
              EXISTS (
                SELECT 1 FROM customer_stage_history initial_history
                WHERE initial_history.customer_id=c.id
                  AND initial_history.from_stage IS NULL
                  AND initial_history.to_stage='新线索'
                  AND initial_history.changed_at >= c.created_at
                  AND initial_history.changed_at <= $3::timestamptz
              ) AS has_initial_history
            FROM customers c
            LEFT JOIN customer_acquisition ca ON ca.customer_id=c.id
            JOIN source_dictionary sd ON sd.code=COALESCE(ca.source_code,c.source_code)
            WHERE (c.created_at AT TIME ZONE 'Asia/Shanghai')::date BETWEEN $1::date AND $2::date
              AND c.created_at <= $3::timestamptz
              AND ($4::text IS NULL OR COALESCE(ca.source_code,c.source_code)=$4)
          ), stages AS (
            SELECT stage,COUNT(*)::int AS count FROM scoped GROUP BY stage
          ), lead_base AS (
            SELECT * FROM scoped WHERE initial_kind='新线索'
          ), classified AS (
            SELECT lead_base.*,
              CASE WHEN basis NOT IN ('captured','manually_confirmed') OR basis IS NULL OR NOT has_initial_history THEN 'historyToReview'
                WHEN NOT mature THEN 'observing'
                ELSE 'eligible' END AS cohort_status
            FROM lead_base
          ), milestones AS (
            SELECT c.id,c.acquisition_source_code,c.acquisition_source_label,c.cohort_status,
              BOOL_OR(h.to_stage='已联系') FILTER (WHERE h.id IS NOT NULL) AS contacted,
              BOOL_OR(h.to_stage='需求了解中') FILTER (WHERE h.id IS NOT NULL) AS needs,
              BOOL_OR(h.to_stage IN ('已成交','已有客户')) FILTER (WHERE h.id IS NOT NULL) AS converted,
              BOOL_OR(h.to_stage='已成交') FILTER (WHERE h.id IS NOT NULL) AS deals
            FROM classified c
            LEFT JOIN customer_stage_history h ON h.customer_id=c.id
              AND h.changed_at >= c.created_at
              AND h.changed_at < c.created_at + INTERVAL '90 days'
              AND h.changed_at <= $3::timestamptz
            GROUP BY c.id,c.acquisition_source_code,c.acquisition_source_label,c.cohort_status
          ), overall AS (
            SELECT COUNT(*)::int AS total_leads,
              COUNT(*) FILTER (WHERE cohort_status='eligible')::int AS eligible_leads,
              COUNT(*) FILTER (WHERE cohort_status='observing')::int AS observing_leads,
              COUNT(*) FILTER (WHERE cohort_status='historyToReview')::int AS history_to_review,
              COUNT(*) FILTER (WHERE cohort_status='eligible' AND contacted)::int AS contacted,
              COUNT(*) FILTER (WHERE cohort_status='eligible' AND needs)::int AS needs,
              COUNT(*) FILTER (WHERE cohort_status='eligible' AND converted)::int AS converted,
              COUNT(*) FILTER (WHERE cohort_status='eligible' AND deals)::int AS deals
            FROM milestones
          ), by_source AS (
            SELECT acquisition_source_code AS code,acquisition_source_label AS label,
              COUNT(*)::int AS total_leads,
              COUNT(*) FILTER (WHERE cohort_status='eligible')::int AS eligible_leads,
              COUNT(*) FILTER (WHERE cohort_status='observing')::int AS observing_leads,
              COUNT(*) FILTER (WHERE cohort_status='historyToReview')::int AS history_to_review,
              COUNT(*) FILTER (WHERE cohort_status='eligible' AND contacted)::int AS contacted,
              COUNT(*) FILTER (WHERE cohort_status='eligible' AND needs)::int AS needs,
              COUNT(*) FILTER (WHERE cohort_status='eligible' AND converted)::int AS converted,
              COUNT(*) FILTER (WHERE cohort_status='eligible' AND deals)::int AS deals
            FROM milestones GROUP BY acquisition_source_code,acquisition_source_label
          )
          SELECT
            (SELECT COUNT(*)::int FROM scoped) AS stage_total,
            (SELECT COALESCE(json_agg(json_build_object('stage',stage,'count',count)), '[]'::json)
              FROM stages) AS stage_items,
            (SELECT to_json(overall) FROM overall) AS totals,
            (SELECT COALESCE(json_agg(json_build_object(
              'code',code,'label',label,'totalLeads',total_leads,'eligibleLeads',eligible_leads,
              'observingLeads',observing_leads,'historyToReview',history_to_review,
              'contacted',contacted,'needs',needs,'converted',converted,'deals',deals
            ) ORDER BY total_leads DESC,code), '[]'::json) FROM by_source) AS by_source`, [from, to, asOf, sourceCode]),
      ]);

      const aggregate = aggregateResult.rows[0];
      const stageCounts = new Map((aggregate.stage_items || []).map((item) => [item.stage, number(item.count)]));
      const totals = aggregate.totals || {};
      const eligibleLeads = number(totals.eligible_leads);
      const convertSource = (item) => {
        const eligible = number(item.eligibleLeads ?? item.eligible_leads);
        const converted = number(item.converted);
        const deals = number(item.deals);
        return {
          code: item.code,
          label: item.label,
          totalLeads: number(item.totalLeads ?? item.total_leads),
          eligibleLeads: eligible,
          observingLeads: number(item.observingLeads ?? item.observing_leads),
          historyToReview: number(item.historyToReview ?? item.history_to_review),
          contacted: number(item.contacted),
          needs: number(item.needs),
          converted,
          deals,
          convertedRate: rate(converted, eligible),
          dealRate: rate(deals, eligible),
        };
      };
      const converted = number(totals.converted);
      const deals = number(totals.deals);
      return {
        asOf: asOfText,
        filters: { from, to, sourceCode, windowDays: WINDOW_DAYS },
        sourceOptions: optionsResult.rows,
        stageDistribution: {
          total: number(aggregate.stage_total),
          items: STAGES.map((stage) => {
            const count = stageCounts.get(stage) || 0;
            return { stage, count, percent: number(aggregate.stage_total) ? rate(count, number(aggregate.stage_total)) : 0 };
          }),
        },
        conversion: {
          totalLeads: number(totals.total_leads),
          eligibleLeads,
          observingLeads: number(totals.observing_leads),
          historyToReview: number(totals.history_to_review),
          totals: {
            contacted: number(totals.contacted),
            needs: number(totals.needs),
            converted,
            deals,
            convertedRate: rate(converted, eligibleLeads),
            dealRate: rate(deals, eligibleLeads),
          },
          bySource: (aggregate.by_source || []).map(convertSource),
        },
      };
    });
  }

  async updateCustomerAcquisition(id, body = {}) {
    const initialKind = String(body.initialKind || '').trim();
    const sourceCode = String(body.sourceCode || '').trim();
    const reason = String(body.reason || '').trim();
    if (![LEAD_KIND, EXISTING_KIND].includes(initialKind)) throw new BadRequestException('初始身份只能是“新线索”或“已有客户”');
    if (!sourceCode) throw new BadRequestException('请选择获客来源');
    if (!reason) throw new BadRequestException('请填写更正或确认原因');
    if (reason.length > 500) throw new BadRequestException('原因不能超过 500 个字');

    await this.db.transaction(async (client) => {
      const customer = await client.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [id]);
      if (!customer.rowCount) throw new NotFoundException('找不到这位客户');
      const currentResult = await client.query('SELECT * FROM customer_acquisition WHERE customer_id=$1 FOR UPDATE', [id]);
      const current = currentResult.rows[0];
      if (!current) throw new NotFoundException('找不到这位客户的获客记录');
      const sourceResult = await client.query('SELECT code FROM source_dictionary WHERE code=$1', [sourceCode]);
      if (!sourceResult.rowCount) throw new BadRequestException('获客来源无效');
      if (current.basis === 'manually_confirmed' && current.initial_kind === initialKind && current.source_code === sourceCode) return;

      await client.query(`INSERT INTO customer_acquisition_corrections(
        customer_id,previous_initial_kind,next_initial_kind,previous_source_code,next_source_code,previous_basis,reason
      ) VALUES($1,$2,$3,$4,$5,$6,$7)`, [id,current.initial_kind,initialKind,current.source_code,sourceCode,current.basis,reason]);
      await client.query(`UPDATE customer_acquisition SET initial_kind=$2,source_code=$3,basis='manually_confirmed',recorded_at=NOW()
        WHERE customer_id=$1`, [id,initialKind,sourceCode]);
    });

    const { rows } = await this.db.query(`SELECT ca.customer_id,ca.initial_kind,ca.source_code,sd.label AS source,ca.basis,ca.recorded_at
      FROM customer_acquisition ca JOIN source_dictionary sd ON sd.code=ca.source_code WHERE ca.customer_id=$1`, [id]);
    const acquisition = rows[0];
    return {
      customerId: Number(acquisition.customer_id),
      initialKind: acquisition.initial_kind,
      sourceCode: acquisition.source_code,
      source: acquisition.source,
      basis: acquisition.basis,
      recordedAt: acquisition.recorded_at,
    };
  }
}
