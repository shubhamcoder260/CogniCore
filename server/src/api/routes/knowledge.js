const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth, requireCapability, canRead, canManage } = require('../../security/rbac');
const { AuthRegistry } = require('../../security/auth.registry');
const { DatasetRegistry } = require('../../ingestion/dataset.registry');
const { OrgKnowledge, KINDS } = require('../../knowledge/org.knowledge');

const router = express.Router();
router.use(requireAuth);

// GET /api/knowledge?datasetId=  - anyone who can read the dataset may see its definitions
router.get('/', (req, res) => {
  const { datasetId } = req.query;
  if (datasetId) {
    const ds = DatasetRegistry.get(datasetId);
    if (!ds || !canRead(req.user, ds)) return res.status(404).json({ error: true, message: 'Dataset not found.' });
  }
  const entries = OrgKnowledge.list(datasetId || null).filter((k) => k.scope === '*' || !datasetId || k.scope === datasetId);
  const visible = datasetId || req.user.role === 'admin' ? entries : entries.filter((k) => k.scope === '*');
  res.json({ entries: visible, kinds: KINDS });
});

// POST /api/knowledge  { scope?, kind?, term, definition }
router.post('/', requireCapability('knowledge.manage'), asyncHandler(async (req, res) => {
  const { scope = '*', kind = 'glossary', term, definition } = req.body || {};
  if (scope === '*' && req.user.role !== 'admin') {
    return res.status(403).json({ error: true, message: 'Creating global knowledge (scope "*") requires admin role.' });
  }
  if (scope !== '*') {
    const ds = DatasetRegistry.get(scope);
    if (!ds || !canRead(req.user, ds)) return res.status(400).json({ error: true, message: 'Unknown dataset scope.' });
  }
  let id;
  try { id = OrgKnowledge.add({ scope, kind, term, definition, createdBy: req.user.user_id }); } catch (e) { return res.status(400).json({ error: true, message: e.message }); }
  AuthRegistry.appendAudit({ userId: req.user.user_id, action: 'knowledge.create', resourceType: 'knowledge', resourceId: id, success: true, details: { scope, kind, term } });
  res.status(201).json({ id });
}));

router.delete('/:id', requireCapability('knowledge.manage'), (req, res) => {
  const item = OrgKnowledge.get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: true, message: 'Knowledge entry not found.' });
  }

  const isOwner = item.created_by && item.created_by === req.user.user_id;
  const isAdmin = req.user.role === 'admin';
  let hasDatasetManage = false;

  if (item.scope && item.scope !== '*') {
    const ds = DatasetRegistry.get(item.scope);
    if (ds && canManage(req.user, ds)) {
      hasDatasetManage = true;
    }
  }

  if (!isAdmin && !isOwner && !hasDatasetManage) {
    AuthRegistry.appendAudit({ userId: req.user.user_id, action: 'knowledge.delete_denied', resourceType: 'knowledge', resourceId: req.params.id, success: false });
    return res.status(403).json({ error: true, message: 'Deleting knowledge requires ownership or dataset management permission.' });
  }

  OrgKnowledge.remove(req.params.id);
  AuthRegistry.appendAudit({ userId: req.user.user_id, action: 'knowledge.delete', resourceType: 'knowledge', resourceId: req.params.id, success: true });
  res.json({ ok: true });
});

module.exports = router;
