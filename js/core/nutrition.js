/* Расчёт норм питания и КБЖУ блюд. */
(function () {
  'use strict';

  const ACTIVITY = {
    1.2:   'Сидячий образ жизни, спорта нет',
    1.375: 'Лёгкая активность, 1-3 тренировки в неделю',
    1.55:  'Средняя активность, 3-5 тренировок',
    1.725: 'Высокая активность, 6-7 тренировок',
    1.9:   'Тяжёлый физический труд'
  };

  const GOALS = {
    cut:      { n: 'Снижение веса', kcalMul: 0.80 },
    maintain: { n: 'Поддержание',   kcalMul: 1.00 },
    bulk:     { n: 'Набор массы',   kcalMul: 1.12 }
  };

  /* Белок, г на кг массы тела. Зависит и от цели, и от нагрузки: чем тяжелее
     работа или тренировки, тем больше белка нужно на восстановление, а на
     дефиците калорий он ещё и защищает мышцы от распада. Диапазон 1,2–2,4
     соответствует позиции ISSN и ACSM: 1,4–2,0 г/кг для физически активных
     и до ~2,4 г/кг при похудении с сохранением мышц. */
  const PROTEIN_PER_KG = {
    '1.2':   { cut: 1.6, maintain: 1.2, bulk: 1.6 },
    '1.375': { cut: 1.8, maintain: 1.5, bulk: 1.7 },
    '1.55':  { cut: 2.0, maintain: 1.6, bulk: 1.8 },
    '1.725': { cut: 2.2, maintain: 1.8, bulk: 2.0 },
    '1.9':   { cut: 2.4, maintain: 2.0, bulk: 2.2 }
  };

  /* Жиры: ниже 0,8 г/кг падает синтез гормонов и усвоение жирорастворимых
     витаминов, поэтому это пол, а не цель. */
  const FAT_PER_KG = { cut: 0.9, maintain: 1.0, bulk: 1.0 };
  const FAT_FLOOR_PER_KG = 0.8;

  // Белок дороже всех макронутриентов, поэтому ограничиваем его сверху:
  // выше трети рациона он не даёт пользы, а бюджет ломает.
  const PROTEIN_MAX_KCAL_SHARE = 0.35;

  /* Активность в профиле хранится числом; берём ближайшую ступень таблицы,
     чтобы произвольное значение не обрушило расчёт. */
  function nearestActivity(value) {
    const keys = Object.keys(PROTEIN_PER_KG);
    return keys.reduce(function (best, key) {
      return Math.abs(key - value) < Math.abs(best - value) ? key : best;
    }, keys[0]);
  }

  function proteinPerKg(person) {
    const goal = GOALS[person.goal] ? person.goal : 'maintain';
    return PROTEIN_PER_KG[nearestActivity(person.activity)][goal];
  }

  function fatPerKg(person) {
    return FAT_PER_KG[person.goal] || FAT_PER_KG.maintain;
  }

  /* Базовый обмен по формуле Mifflin-St Jeor — она даёт наименьшую ошибку
     на людях без экстремального состава тела. */
  function bmr(person) {
    const base = 10 * person.weight + 6.25 * person.height - 5 * person.age;
    return person.sex === 'm' ? base + 5 : base - 161;
  }

  /* Суточная норма одного человека. Ручной ввод (person.manual) всегда
     побеждает расчёт — пользователь может знать свои цифры точнее формулы. */
  function personTargets(person) {
    if (person.manual && person.manual.kcal > 0) {
      const m = person.manual;
      return { kcal: m.kcal, p: m.p, f: m.f, c: m.c, manual: true };
    }
    const goal = GOALS[person.goal] || GOALS.maintain;
    const kcal = Math.round(bmr(person) * person.activity * goal.kcalMul);

    const usedProtPerKg = person.protPerKg || proteinPerKg(person);
    const usedFatPerKg = Math.max(FAT_FLOOR_PER_KG, person.fatPerKg || fatPerKg(person));

    let p = Math.round(person.weight * usedProtPerKg);
    const f = Math.round(person.weight * usedFatPerKg);

    // Потолок по белку: у людей с большим весом расчёт «на кг» иначе уводит
    // в 250 г белка, которые и не нужны, и стоят как половина бюджета.
    const pCap = Math.round(kcal * PROTEIN_MAX_KCAL_SHARE / 4);
    if (p > pCap) p = pCap;

    // Углеводы — то, что осталось после белка и жира.
    let c = Math.round((kcal - p * 4 - f * 9) / 4);
    if (c < 50) c = 50; // ниже этого рацион перестаёт быть выполнимым

    return {
      kcal, p, f, c, manual: false,
      protPerKg: Math.round(usedProtPerKg * 100) / 100,
      fatPerKg: Math.round(usedFatPerKg * 100) / 100,
      protCapped: p === pCap
    };
  }

  /* Суммарная суточная норма всех едоков. */
  function householdTargets(people) {
    return people.reduce((acc, person) => {
      const t = personTargets(person);
      acc.kcal += t.kcal; acc.p += t.p; acc.f += t.f; acc.c += t.c;
      return acc;
    }, { kcal: 0, p: 0, f: 0, c: 0 });
  }

  /* КБЖУ произвольного набора ингредиентов [{p, g}] с учётом отхода при чистке:
     в тарелку попадает не весь купленный вес. */
  function nutritionOf(ingredients, productsById) {
    const out = { kcal: 0, p: 0, f: 0, c: 0 };
    ingredients.forEach(function (i) {
      const prod = productsById[i.p];
      if (!prod) return;
      const edible = i.g * (1 - (prod.wst || 0));
      const k = edible / 100;
      out.kcal += prod.k * k;
      out.p += prod.p * k;
      out.f += prod.f * k;
      out.c += prod.c * k;
    });
    out.kcal = Math.round(out.kcal);
    out.p = Math.round(out.p * 10) / 10;
    out.f = Math.round(out.f * 10) / 10;
    out.c = Math.round(out.c * 10) / 10;
    return out;
  }

  function recipeNutrition(recipe, productsById) {
    const total = nutritionOf(recipe.ing, productsById);
    const sv = recipe.sv || 1;
    return {
      total: total,
      perServing: {
        kcal: Math.round(total.kcal / sv),
        p: Math.round(total.p / sv * 10) / 10,
        f: Math.round(total.f / sv * 10) / 10,
        c: Math.round(total.c / sv * 10) / 10
      }
    };
  }

  /* Насколько факт разошёлся с планом, в процентах со знаком. */
  function deviation(actual, target) {
    if (!target) return 0;
    return Math.round((actual - target) / target * 100);
  }

  window.App = window.App || {};
  window.App.nutrition = {
    ACTIVITY: ACTIVITY,
    GOALS: GOALS,
    PROTEIN_PER_KG: PROTEIN_PER_KG,
    proteinPerKg: proteinPerKg,
    fatPerKg: fatPerKg,
    bmr: bmr,
    personTargets: personTargets,
    householdTargets: householdTargets,
    nutritionOf: nutritionOf,
    recipeNutrition: recipeNutrition,
    deviation: deviation
  };
})();
