import { Alert, Card, Empty, Space, Tag, Typography } from 'antd';
import { buildFamilyPolicyDiagnosis } from './family-policy-diagnosis.js';

const {Text,Title}=Typography;

export function FamilyPolicyDiagnosis({family}) {
  const diagnosis=buildFamilyPolicyDiagnosis(family);
  const attentionCount=diagnosis.unassignedInsuredPolicyCount+diagnosis.unclassifiedPolicyCount+diagnosis.reviewPolicyCount+diagnosis.unlinkedPropertyPolicyCount;
  return <Card className="panel-card family-diagnosis-card" title={<div><Title level={4}>家庭保单初筛</Title><Text className="muted">按已关联的被保险人、保障分类和合同状态汇总</Text></div>}>
    <Alert className="family-diagnosis-note" type="info" showIcon message="初筛只反映当前档案记录；‘暂无记录’不代表实际没有保障，请对照保单合同核实。" />
    {!diagnosis.policyCount ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未关联家庭保单，暂时无法初筛" /> : <>
      {attentionCount ? <div className="family-diagnosis-attention">
        <Text strong>以下保单资料需要补齐或核对</Text>
        <Space wrap size={[8,8]}>
          {diagnosis.unassignedInsuredPolicyCount ? <Tag color="gold">{diagnosis.unassignedInsuredPolicyCount} 份未关联被保险人</Tag> : null}
          {diagnosis.unclassifiedPolicyCount ? <Tag color="gold">{diagnosis.unclassifiedPolicyCount} 份未分类</Tag> : null}
          {diagnosis.reviewPolicyCount ? <Tag color="gold">{diagnosis.reviewPolicyCount} 份暂不计入当前有效保障</Tag> : null}
          {diagnosis.unlinkedPropertyPolicyCount ? <Tag color="gold">{diagnosis.unlinkedPropertyPolicyCount} 份财产险未关联投保对象</Tag> : null}
        </Space>
      </div> : <Text className="family-diagnosis-clear">当前纳入初筛的保单均已分类并标记为已核实且有效。</Text>}
      <div className="family-diagnosis-members">{diagnosis.members.map((member)=><section className="family-diagnosis-member" key={member.id}>
        <div className="family-diagnosis-member-head"><Text strong>{member.name}</Text><Text className="schedule-meta">{member.insuredPolicyCount ? `${member.insuredPolicyCount} 份被保险人保单` : '未关联被保险人保单'}</Text></div>
        <div className="family-diagnosis-category-list">{member.coverages.map((coverage)=><div className="family-diagnosis-category" key={coverage.key}>
          <Text>{coverage.label}</Text>
          {coverage.status==='recorded' ? <Tag color="green">已核实记录 {coverage.verifiedCount} 份</Tag> : null}
          {coverage.status==='review' ? <Tag color="gold">{coverage.pendingCount} 份待核对</Tag> : null}
          {coverage.status==='noncurrent' ? <Tag>{coverage.nonCurrentCount} 份非在保记录</Tag> : null}
          {coverage.status==='none' ? <Tag>档案暂无记录</Tag> : null}
        </div>)}</div>
      </section>)}</div>
      {diagnosis.propertyPolicyCount ? <Text className="family-diagnosis-property">另有 {diagnosis.propertyPolicyCount} 份家财险或车险分类保单，需结合投保对象和合同单独核对。</Text> : null}
    </>}
  </Card>;
}
