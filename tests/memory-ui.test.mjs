import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMemoryStateToFields } from '../memoryUi.mjs';

test('applyMemoryStateToFields writes profile, goals and facts into the UI fields', () => {
  const profileField = { value: '' };
  const goalsField = { value: '' };
  const factsField = { value: '' };

  applyMemoryStateToFields(
    {
      profile: 'Ada',
      goals: ['Yapay zeka ürününü tamamla', 'Bir demo hazırla'],
      facts: ['Favori şehir İstanbul', 'Çalışma saati gece'],
    },
    {
      profile: profileField,
      goals: goalsField,
      facts: factsField,
    }
  );

  assert.equal(profileField.value, 'Ada');
  assert.equal(goalsField.value, 'Yapay zeka ürününü tamamla\nBir demo hazırla');
  assert.equal(factsField.value, 'Favori şehir İstanbul\nÇalışma saati gece');
});

test('applyMemoryStateToFields overwrites prior values when profile data changes', () => {
  const profileField = { value: 'mahmut' };
  const goalsField = { value: 'eski hedef' };
  const factsField = { value: 'eski gerçek' };

  applyMemoryStateToFields(
    {
      profile: 'Ahmet',
      goals: ['Yeni hedef'],
      facts: ['Yeni gerçek'],
    },
    {
      profile: profileField,
      goals: goalsField,
      facts: factsField,
    }
  );

  assert.equal(profileField.value, 'Ahmet');
  assert.equal(goalsField.value, 'Yeni hedef');
  assert.equal(factsField.value, 'Yeni gerçek');
});
