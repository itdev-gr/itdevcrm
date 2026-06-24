import { describe, it, expect } from 'vitest';
import { classifyAccountingStageMove } from './accountingStageMove';

const base = { paidStageId: 'paid', closedStageId: 'closed' };

describe('classifyAccountingStageMove', () => {
  it('noop when no target', () => {
    expect(classifyAccountingStageMove({ ...base, targetStageId: '', currentStageId: 'new' })).toBe('noop');
  });
  it('noop when target equals current stage', () => {
    expect(classifyAccountingStageMove({ ...base, targetStageId: 'new', currentStageId: 'new' })).toBe('noop');
  });
  it('close when target is the closed stage', () => {
    expect(classifyAccountingStageMove({ ...base, targetStageId: 'closed', currentStageId: 'new' })).toBe('close');
  });
  it('paid when target is the paid-in-full stage', () => {
    expect(classifyAccountingStageMove({ ...base, targetStageId: 'paid', currentStageId: 'new' })).toBe('paid');
  });
  it('move for any other stage', () => {
    expect(classifyAccountingStageMove({ ...base, targetStageId: 'on_hold', currentStageId: 'new' })).toBe('move');
  });
  it('move works even when paid/closed ids are not provided', () => {
    expect(classifyAccountingStageMove({ targetStageId: 'on_hold', currentStageId: 'new' })).toBe('move');
  });
});
