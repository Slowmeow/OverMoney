/* Каталог продуктов.
 *
 * ВАЖНО про цены: значения `pr` — ориентировочные розничные цены Пятёрочки/Магнита.
 * Это стартовая заготовка, а не живые данные. После первой же закупки правьте их
 * на экране «Цены» — приложение помечает всё, что старше 30 дней, как устаревшее.
 *
 * Схема:
 *   id   — код продукта, используется в рецептах
 *   n    — название
 *   cat  — категория (для группировки списка покупок по отделам магазина)
 *   unit — базовая единица: 'g' (граммы) или 'ml' (миллилитры)
 *   pack — сколько базовых единиц в одной покупке (для весовых — 1000, т.е. цена за кг)
 *   pl   — как выглядит упаковка на полке
 *   w    — весовой ли товар (true = можно взять сколько угодно, false = только целыми пачками)
 *   pr   — цена за одну упаковку `pack`, в рублях
 *   k/p/f/c — ккал / белки / жиры / углеводы на 100 базовых единиц
 *   wst  — доля отхода при готовке (кожура, обрезь): 0.25 = четверть уходит в мусор
 *   life — срок годности в днях после покупки (влияет на порядок расходования)
 *   grp  — группа взаимозамены: чем оптимизатор может заменить при нехватке бюджета
 *          (null = не заменять; так помечено всё, что задаёт вкус блюда, а не питательность:
 *           зелень, лимон, мука — экономия на них копеечная, а блюдо разваливается)
 *   role — роль в рационе: protein | carb | fat | veg | fruit | other
 *   piece— граммов в одной штуке (если продукт удобно считать штуками)
 *   maxWeek — сколько этого продукта максимум разумно съесть одному человеку за неделю.
 *          Без такого потолка оптимизатор, честно ища минимум цены, закупает
 *          два килограмма куриной печени и считает задачу решённой.
 */
(function () {
  'use strict';

  const P = (id, n, cat, pack, pl, w, pr, k, p, f, c, extra) =>
    Object.assign({ id, n, cat, unit: 'g', pack, pl, w, pr, k, p, f, c, wst: 0, life: 180, grp: null, role: 'other' }, extra || {});

  const PRODUCTS = [
    // ---------- МЯСО И ПТИЦА ----------
    P('chicken_thigh', 'Бедро куриное, филе', 'meat', 1000, 'кг', true, 349, 185, 17.0, 12.0, 0, { life: 3, grp: 'prot_meat', role: 'protein' }),
    P('chicken_breast', 'Грудка куриная, филе', 'meat', 1000, 'кг', true, 419, 113, 23.6, 1.9, 0, { life: 3, grp: 'prot_meat', role: 'protein' }),
    P('chicken_drums', 'Голень куриная', 'meat', 1000, 'кг', true, 259, 158, 16.8, 10.2, 0, { life: 3, wst: 0.22, grp: 'prot_meat', role: 'protein' }),
    P('chicken_wings', 'Крылья куриные', 'meat', 1000, 'кг', true, 279, 186, 19.2, 12.2, 0, { life: 3, wst: 0.2, grp: 'prot_meat', role: 'protein' }),
    P('chicken_whole', 'Курица целая, тушка', 'meat', 1000, 'кг', true, 229, 219, 18.2, 16.0, 0, { life: 4, wst: 0.3, grp: 'prot_meat', role: 'protein', maxWeek: 1200 }),
    P('chicken_liver', 'Печень куриная', 'meat', 500, 'лоток 500 г', false, 139, 137, 20.4, 5.9, 0.7, { life: 2, grp: 'prot_meat', role: 'protein', maxWeek: 250 }),
    P('mince_mixed', 'Фарш свино-говяжий', 'meat', 1000, 'кг', true, 459, 263, 15.0, 22.0, 0.5, { life: 2, grp: 'prot_meat', role: 'protein' }),
    P('mince_chicken', 'Фарш куриный', 'meat', 1000, 'кг', true, 349, 143, 17.4, 8.1, 0.5, { life: 2, grp: 'prot_meat', role: 'protein' }),
    P('pork_shoulder', 'Свинина, лопатка', 'meat', 1000, 'кг', true, 429, 257, 16.0, 21.5, 0, { life: 4, grp: 'prot_meat', role: 'protein' }),
    P('beef_stew', 'Говядина для тушения', 'meat', 1000, 'кг', true, 689, 187, 18.9, 12.4, 0, { life: 4, grp: 'prot_meat', role: 'protein' }),
    P('sausages', 'Сосиски', 'meat', 450, 'упак. 450 г', false, 219, 266, 10.4, 24.0, 1.6, { life: 14, grp: 'prot_meat', role: 'protein', maxWeek: 300 }),
    P('bacon', 'Грудинка / бекон', 'meat', 200, 'упак. 200 г', false, 189, 375, 12.0, 36.0, 0.5, { life: 21, grp: 'prot_meat', role: 'fat', maxWeek: 150 }),

    // ---------- РЫБА ----------
    P('pollock', 'Минтай, тушка мороженая', 'fish', 1000, 'кг', true, 279, 72, 15.9, 0.9, 0, { life: 60, wst: 0.25, grp: 'prot_fish', role: 'protein' }),
    P('hake', 'Хек мороженый', 'fish', 1000, 'кг', true, 359, 86, 16.6, 2.2, 0, { life: 60, wst: 0.2, grp: 'prot_fish', role: 'protein' }),
    P('mackerel', 'Скумбрия мороженая', 'fish', 1000, 'кг', true, 389, 191, 18.0, 13.2, 0, { life: 60, wst: 0.25, grp: 'prot_fish', role: 'protein', maxWeek: 450 }),
    P('herring', 'Сельдь солёная', 'fish', 1000, 'кг', true, 329, 217, 16.4, 16.5, 0, { life: 14, wst: 0.35, grp: 'prot_fish', role: 'protein', maxWeek: 250 }),
    P('tuna_can', 'Тунец консервированный', 'fish', 185, 'банка 185 г', false, 149, 96, 21.0, 1.0, 0, { life: 720, grp: 'prot_fish', role: 'protein', maxWeek: 280 }),
    P('sprat_can', 'Сайра / килька в томате', 'fish', 240, 'банка 240 г', false, 99, 162, 13.0, 10.0, 4.0, { life: 720, grp: 'prot_fish', role: 'protein', maxWeek: 250 }),

    // ---------- МОЛОЧКА И ЯЙЦА ----------
    P('egg', 'Яйцо куриное С1', 'dairy', 550, 'десяток', false, 119, 157, 12.7, 11.5, 0.7, { life: 25, piece: 55, wst: 0.12, grp: 'prot_egg', role: 'protein' }),
    P('milk', 'Молоко 2,5%', 'dairy', 900, 'бутылка 900 мл', false, 89, 54, 2.9, 2.5, 4.8, { unit: 'ml', life: 7, grp: 'dairy_liquid', role: 'protein' }),
    P('kefir', 'Кефир 2,5%', 'dairy', 900, 'бутылка 900 мл', false, 99, 53, 3.0, 2.5, 4.0, { unit: 'ml', life: 10, grp: 'dairy_liquid', role: 'protein' }),
    P('yogurt_nat', 'Йогурт натуральный', 'dairy', 290, 'банка 290 г', false, 89, 66, 5.0, 3.2, 4.0, { life: 14, grp: 'dairy_liquid', role: 'protein' }),
    P('tvorog5', 'Творог 5%', 'dairy', 200, 'пачка 200 г', false, 99, 121, 17.2, 5.0, 1.8, { life: 7, grp: 'prot_dairy', role: 'protein' }),
    P('tvorog9', 'Творог 9%', 'dairy', 200, 'пачка 200 г', false, 109, 159, 16.7, 9.0, 2.0, { life: 7, grp: 'prot_dairy', role: 'protein' }),
    P('smetana', 'Сметана 15%', 'dairy', 300, 'банка 300 г', false, 109, 162, 2.6, 15.0, 3.0, { life: 14, grp: 'fat_dairy', role: 'fat' }),
    P('cheese_rus', 'Сыр Российский', 'dairy', 1000, 'кг', true, 899, 363, 23.0, 29.0, 0.3, { life: 30, grp: 'prot_dairy', role: 'protein' }),
    P('cheese_cream', 'Сыр творожный', 'dairy', 140, 'ванночка 140 г', false, 129, 253, 6.0, 24.0, 3.5, { life: 30, grp: 'fat_dairy', role: 'fat' }),
    P('butter', 'Масло сливочное 82%', 'dairy', 180, 'пачка 180 г', false, 239, 748, 0.8, 82.5, 0.8, { life: 60, grp: 'fat_butter', role: 'fat' }),

    // ---------- КРУПЫ, МАКАРОНЫ, МУКА ----------
    P('buckwheat', 'Гречка ядрица', 'grain', 800, 'пачка 800 г', false, 95, 313, 12.6, 3.3, 62.1, { life: 365, grp: 'carb_grain', role: 'carb' }),
    P('rice_round', 'Рис круглозёрный', 'grain', 800, 'пачка 800 г', false, 105, 344, 6.7, 0.7, 78.9, { life: 365, grp: 'carb_grain', role: 'carb' }),
    P('rice_long', 'Рис длиннозёрный', 'grain', 800, 'пачка 800 г', false, 129, 340, 7.5, 1.0, 77.0, { life: 365, grp: 'carb_grain', role: 'carb' }),
    P('oats', 'Овсяные хлопья', 'grain', 500, 'пачка 500 г', false, 79, 352, 12.3, 6.2, 61.8, { life: 240, grp: 'carb_grain', role: 'carb' }),
    P('pearl_barley', 'Перловка', 'grain', 800, 'пачка 800 г', false, 69, 315, 9.3, 1.1, 66.9, { life: 365, grp: 'carb_grain', role: 'carb' }),
    P('millet', 'Пшено', 'grain', 800, 'пачка 800 г', false, 79, 342, 11.5, 3.3, 66.5, { life: 240, grp: 'carb_grain', role: 'carb' }),
    P('semolina', 'Манка', 'grain', 800, 'пачка 800 г', false, 75, 328, 10.3, 1.0, 70.6, { life: 240, grp: 'carb_grain', role: 'carb' }),
    P('pasta', 'Макароны', 'grain', 450, 'пачка 450 г', false, 79, 344, 10.4, 1.1, 71.5, { life: 365, grp: 'carb_pasta', role: 'carb' }),
    P('noodles_egg', 'Лапша яичная', 'grain', 400, 'пачка 400 г', false, 99, 357, 11.5, 2.4, 71.0, { life: 365, grp: 'carb_pasta', role: 'carb' }),
    P('flour', 'Мука пшеничная', 'grain', 2000, 'пачка 2 кг', false, 149, 342, 10.3, 1.1, 70.6, { life: 365, grp: null, role: 'carb' }),
    P('peas_dry', 'Горох колотый', 'grain', 800, 'пачка 800 г', false, 79, 298, 20.5, 2.0, 49.5, { life: 365, grp: 'prot_legume', role: 'protein' }),
    P('lentils', 'Чечевица', 'grain', 800, 'пачка 800 г', false, 139, 295, 24.0, 1.5, 46.3, { life: 365, grp: 'prot_legume', role: 'protein' }),
    P('beans_can', 'Фасоль консервированная', 'grain', 400, 'банка 400 г', false, 85, 99, 6.7, 0.3, 17.4, { life: 720, grp: 'prot_legume', role: 'protein' }),
    P('beans_dry', 'Фасоль сухая', 'grain', 800, 'пачка 800 г', false, 149, 298, 21.0, 2.0, 47.0, { life: 365, grp: 'prot_legume', role: 'protein' }),

    // ---------- ОВОЩИ ----------
    P('potato', 'Картофель', 'veg', 1000, 'кг', true, 45, 77, 2.0, 0.4, 16.3, { life: 60, wst: 0.25, grp: 'carb_potato', role: 'carb' }),
    P('onion', 'Лук репчатый', 'veg', 1000, 'кг', true, 39, 41, 1.4, 0.2, 8.2, { life: 45, wst: 0.15, grp: 'veg_base', role: 'veg' }),
    P('carrot', 'Морковь', 'veg', 1000, 'кг', true, 45, 35, 1.3, 0.1, 6.9, { life: 45, wst: 0.15, grp: 'veg_base', role: 'veg' }),
    P('cabbage', 'Капуста белокочанная', 'veg', 1000, 'кг', true, 39, 28, 1.8, 0.1, 4.7, { life: 30, wst: 0.15, grp: 'veg_base', role: 'veg' }),
    P('beet', 'Свёкла', 'veg', 1000, 'кг', true, 45, 42, 1.5, 0.1, 8.8, { life: 45, wst: 0.2, grp: 'veg_base', role: 'veg' }),
    P('tomato', 'Помидоры', 'veg', 1000, 'кг', true, 199, 20, 1.1, 0.2, 3.7, { life: 7, grp: 'veg_fresh', role: 'veg' }),
    P('cucumber', 'Огурцы', 'veg', 1000, 'кг', true, 159, 15, 0.8, 0.1, 2.5, { life: 7, grp: 'veg_fresh', role: 'veg' }),
    P('bell_pepper', 'Перец болгарский', 'veg', 1000, 'кг', true, 249, 27, 1.3, 0.1, 5.3, { life: 10, wst: 0.15, grp: 'veg_fresh', role: 'veg' }),
    P('zucchini', 'Кабачок', 'veg', 1000, 'кг', true, 89, 24, 0.6, 0.3, 4.6, { life: 14, wst: 0.1, grp: 'veg_fresh', role: 'veg' }),
    P('garlic', 'Чеснок', 'veg', 1000, 'кг', true, 349, 143, 6.5, 0.5, 29.9, { life: 60, wst: 0.2, grp: 'spice', role: 'other' }),
    P('greens', 'Зелень (укроп/петрушка)', 'veg', 100, 'пучок 100 г', false, 69, 38, 3.0, 0.5, 5.0, { life: 5, grp: null, role: 'veg' }),
    P('mushrooms', 'Шампиньоны', 'veg', 1000, 'кг', true, 289, 22, 4.3, 1.0, 0.1, { life: 5, grp: 'veg_fresh', role: 'veg' }),
    P('veg_frozen', 'Овощная смесь замороженная', 'veg', 400, 'пакет 400 г', false, 129, 45, 2.2, 0.3, 8.2, { life: 180, grp: 'veg_base', role: 'veg' }),
    P('peas_can', 'Горошек зелёный конс.', 'veg', 400, 'банка 400 г', false, 79, 55, 3.6, 0.2, 9.8, { life: 720, grp: 'veg_base', role: 'veg' }),
    P('corn_can', 'Кукуруза конс.', 'veg', 340, 'банка 340 г', false, 89, 58, 2.2, 0.4, 11.2, { life: 720, grp: 'veg_base', role: 'veg' }),
    P('pickles', 'Огурцы солёные', 'veg', 680, 'банка 680 г', false, 139, 11, 0.8, 0.1, 1.7, { life: 365, grp: 'veg_base', role: 'veg' }),
    P('sauerkraut', 'Капуста квашеная', 'veg', 500, 'упак. 500 г', false, 89, 19, 1.8, 0.1, 3.0, { life: 21, grp: 'veg_base', role: 'veg' }),

    // ---------- ФРУКТЫ ----------
    P('apple', 'Яблоки', 'fruit', 1000, 'кг', true, 139, 47, 0.4, 0.4, 9.8, { life: 21, wst: 0.1, grp: 'fruit', role: 'fruit' }),
    P('banana', 'Бананы', 'fruit', 1000, 'кг', true, 129, 96, 1.5, 0.2, 21.8, { life: 6, piece: 130, wst: 0.3, grp: 'fruit', role: 'fruit' }),
    P('orange', 'Апельсины', 'fruit', 1000, 'кг', true, 149, 43, 0.9, 0.2, 8.1, { life: 14, wst: 0.28, grp: 'fruit', role: 'fruit' }),
    P('pear', 'Груши', 'fruit', 1000, 'кг', true, 179, 47, 0.4, 0.3, 10.9, { life: 10, wst: 0.1, grp: 'fruit', role: 'fruit' }),
    P('lemon', 'Лимон', 'fruit', 1000, 'кг', true, 199, 34, 0.9, 0.1, 3.0, { life: 21, piece: 110, wst: 0.4, grp: null, role: 'other' }),
    P('raisins', 'Изюм', 'fruit', 200, 'пачка 200 г', false, 99, 264, 2.9, 0.6, 66.0, { life: 240, grp: 'sweet', role: 'fruit', maxWeek: 200 }),

    // ---------- ХЛЕБ ----------
    P('bread_dark', 'Хлеб ржаной', 'bakery', 700, 'буханка 700 г', false, 65, 214, 6.6, 1.2, 40.7, { life: 5, grp: 'bread', role: 'carb' }),
    P('bread_white', 'Батон нарезной', 'bakery', 400, 'батон 400 г', false, 55, 262, 7.5, 2.9, 51.4, { life: 4, grp: 'bread', role: 'carb' }),
    P('lavash', 'Лаваш тонкий', 'bakery', 300, 'упак. 300 г', false, 79, 236, 7.9, 1.0, 47.6, { life: 7, grp: 'bread', role: 'carb' }),

    // ---------- БАКАЛЕЯ ----------
    P('oil_sun', 'Масло подсолнечное', 'grocery', 1000, 'бутылка 1 л', false, 149, 899, 0, 99.9, 0, { unit: 'ml', life: 365, grp: 'fat_oil', role: 'fat' }),
    P('tomato_paste', 'Томатная паста', 'grocery', 380, 'банка 380 г', false, 89, 92, 4.3, 0.5, 19.0, { life: 365, grp: 'sauce', role: 'other' }),
    P('ketchup', 'Кетчуп', 'grocery', 350, 'упак. 350 г', false, 89, 93, 1.8, 0.2, 21.0, { life: 365, grp: 'sauce', role: 'other' }),
    P('mayo', 'Майонез', 'grocery', 400, 'упак. 400 г', false, 129, 627, 0.3, 67.0, 3.7, { life: 180, grp: 'fat_oil', role: 'fat', maxWeek: 180 }),
    P('soy_sauce', 'Соевый соус', 'grocery', 200, 'бутылка 200 мл', false, 99, 50, 6.0, 0, 6.6, { unit: 'ml', life: 365, grp: 'sauce', role: 'other' }),
    P('sugar', 'Сахар', 'grocery', 900, 'пачка 900 г', false, 79, 399, 0, 0, 99.7, { life: 720, grp: 'sweet', role: 'carb', maxWeek: 300 }),
    P('salt', 'Соль', 'grocery', 1000, 'пачка 1 кг', false, 25, 0, 0, 0, 0, { life: 1800, grp: 'spice', role: 'other' }),
    P('honey', 'Мёд', 'grocery', 250, 'банка 250 г', false, 249, 329, 0.8, 0, 81.5, { life: 720, grp: 'sweet', role: 'carb', maxWeek: 120 }),
    P('peanut_butter', 'Паста арахисовая', 'grocery', 300, 'банка 300 г', false, 279, 588, 25.0, 50.0, 12.0, { life: 240, grp: 'nuts', role: 'fat', maxWeek: 160 }),
    // Изолят соевого белка: почти чистый белок, поэтому в смузи он даёт норму
    // дёшево там, где мясом это стоило бы втрое дороже.
    P('soy_protein', 'Протеин соевый (изолят)', 'grocery', 900, 'банка 900 г', false, 1190, 370, 90.0, 0.5, 1.0, { life: 540, grp: 'prot_dairy', role: 'protein', maxWeek: 300 }),
    P('peanuts', 'Арахис', 'grocery', 200, 'пачка 200 г', false, 99, 567, 26.3, 45.2, 9.9, { life: 180, grp: 'nuts', role: 'fat', maxWeek: 200 }),
    P('walnuts', 'Грецкий орех', 'grocery', 200, 'пачка 200 г', false, 249, 654, 15.2, 65.2, 7.0, { life: 180, grp: 'nuts', role: 'fat', maxWeek: 160 }),
    P('yeast_dry', 'Дрожжи сухие', 'grocery', 100, 'упак. 100 г', false, 79, 325, 40.0, 6.0, 30.0, { life: 365, grp: 'spice', role: 'other' }),
    P('soda_bake', 'Разрыхлитель / сода', 'grocery', 100, 'упак. 100 г', false, 45, 0, 0, 0, 0, { life: 720, grp: 'spice', role: 'other' }),
    P('vinegar', 'Уксус 9%', 'grocery', 500, 'бутылка 500 мл', false, 49, 11, 0, 0, 3.0, { unit: 'ml', life: 720, grp: 'spice', role: 'other' }),
    P('tea', 'Чай чёрный', 'grocery', 100, 'упак. 100 пак.', false, 199, 0, 0, 0, 0, { life: 720, grp: 'drink', role: 'other' }),
    P('coffee', 'Кофе растворимый', 'grocery', 190, 'банка 190 г', false, 449, 0, 0, 0, 0, { life: 720, grp: 'drink', role: 'other' }),
    P('spices_mix', 'Специи (перец, лавр, паприка)', 'grocery', 100, 'набор ~100 г', false, 129, 0, 0, 0, 0, { life: 720, grp: 'spice', role: 'other' }),
    P('cocoa', 'Какао-порошок', 'grocery', 100, 'пачка 100 г', false, 129, 289, 24.2, 15.0, 10.0, { life: 365, grp: 'sweet', role: 'other' }),
    P('choco_dark', 'Шоколад тёмный', 'grocery', 90, 'плитка 90 г', false, 129, 539, 6.2, 35.4, 48.2, { life: 240, grp: 'sweet', role: 'fat', maxWeek: 120 }),
    P('cookies', 'Печенье', 'grocery', 400, 'упак. 400 г', false, 119, 417, 7.5, 11.8, 74.0, { life: 180, grp: 'sweet', role: 'carb', maxWeek: 250 }),

    // ---------- ПОЛУФАБРИКАТЫ И ГОТОВОЕ ----------
    // Дорого за килограмм, но экономит время. Оптимизатор сам решит,
    // когда это оправдано, а когда лучше приготовить с нуля.
    P('pelmeni', 'Пельмени замороженные', 'meat', 800, 'пачка 800 г', false, 359, 248, 11.9, 12.4, 22.0, { life: 180, grp: 'prot_meat', role: 'protein', maxWeek: 500 }),
    P('vareniki', 'Вареники с картофелем', 'meat', 800, 'пачка 800 г', false, 239, 195, 5.2, 4.0, 34.0, { life: 180, grp: null, role: 'carb', maxWeek: 500 }),
    P('nuggets', 'Наггетсы куриные', 'meat', 300, 'пачка 300 г', false, 259, 270, 14.0, 16.0, 17.0, { life: 180, grp: null, role: 'protein', maxWeek: 350 }),
    P('fries_frozen', 'Картофель фри замороженный', 'veg', 750, 'пачка 750 г', false, 239, 165, 2.6, 5.0, 26.0, { life: 180, grp: null, role: 'carb', maxWeek: 500 }),
    P('pizza_frozen', 'Пицца замороженная', 'grain', 350, 'упак. 350 г', false, 289, 248, 10.0, 10.0, 30.0, { life: 180, grp: null, role: 'carb', maxWeek: 400 }),
    P('dough_puff', 'Тесто слоёное замороженное', 'grain', 500, 'пачка 500 г', false, 189, 363, 6.0, 24.0, 31.0, { life: 180, grp: null, role: 'carb' }),
    P('noodles_instant', 'Лапша быстрого приготовления', 'grain', 60, 'пачка 60 г', false, 45, 448, 9.0, 18.0, 62.0, { life: 240, grp: null, role: 'carb', maxWeek: 240 }),
    P('stew_can', 'Тушёнка говяжья', 'meat', 325, 'банка 325 г', false, 269, 220, 15.0, 17.0, 0.4, { life: 720, grp: 'prot_meat', role: 'protein', maxWeek: 350 }),

    // ---------- КОЛБАСНОЕ И СЫРЫ ----------
    P('sausage_boiled', 'Колбаса варёная', 'meat', 500, 'батон 500 г', false, 289, 257, 12.8, 22.2, 1.5, { life: 21, grp: 'prot_meat', role: 'protein', maxWeek: 350 }),
    P('ham', 'Ветчина', 'meat', 400, 'упак. 400 г', false, 299, 209, 16.0, 16.0, 1.0, { life: 21, grp: 'prot_meat', role: 'protein', maxWeek: 350 }),
    P('salami', 'Колбаса копчёная', 'meat', 350, 'палка 350 г', false, 349, 425, 17.0, 40.0, 0.5, { life: 60, grp: 'prot_meat', role: 'fat', maxWeek: 200 }),
    P('lard', 'Сало солёное', 'meat', 400, 'кусок 400 г', false, 299, 797, 2.4, 89.0, 0, { life: 60, grp: null, role: 'fat', maxWeek: 150 }),
    P('mozzarella', 'Сыр моцарелла', 'dairy', 250, 'упак. 250 г', false, 239, 280, 18.0, 22.0, 2.2, { life: 21, grp: 'prot_dairy', role: 'protein' }),
    P('cheese_melted', 'Сыр плавленый', 'dairy', 180, 'упак. 180 г', false, 129, 290, 11.0, 25.0, 3.0, { life: 60, grp: 'fat_dairy', role: 'fat' }),
    P('feta', 'Брынза', 'dairy', 250, 'упак. 250 г', false, 239, 260, 17.0, 20.0, 2.0, { life: 21, grp: 'prot_dairy', role: 'protein' }),
    P('cream10', 'Сливки 10%', 'dairy', 500, 'упак. 500 мл', false, 179, 118, 3.0, 10.0, 4.0, { unit: 'ml', life: 14, grp: 'fat_dairy', role: 'fat' }),
    P('ryazhenka', 'Ряженка', 'dairy', 900, 'бутылка 900 мл', false, 115, 67, 3.0, 4.0, 4.2, { unit: 'ml', life: 10, grp: 'dairy_liquid', role: 'protein' }),
    P('condensed_milk', 'Молоко сгущённое', 'grocery', 380, 'банка 380 г', false, 139, 320, 7.2, 8.5, 56.0, { life: 720, grp: 'sweet', role: 'carb', maxWeek: 200 }),

    // ---------- РЫБА И МОРЕПРОДУКТЫ ----------
    P('pink_salmon', 'Горбуша', 'fish', 1000, 'кг', true, 489, 142, 20.5, 6.5, 0, { life: 60, wst: 0.25, grp: 'prot_fish', role: 'protein' }),
    P('shrimp', 'Креветки варёно-мороженые', 'fish', 500, 'пачка 500 г', false, 459, 95, 20.0, 1.8, 0, { life: 180, wst: 0.45, grp: 'prot_fish', role: 'protein', maxWeek: 300 }),
    P('crab_sticks', 'Крабовые палочки', 'fish', 200, 'упак. 200 г', false, 149, 88, 6.0, 1.0, 13.0, { life: 60, grp: null, role: 'protein', maxWeek: 250 }),
    P('sprats_can', 'Шпроты', 'fish', 160, 'банка 160 г', false, 159, 363, 17.0, 32.0, 0.4, { life: 720, grp: 'prot_fish', role: 'fat', maxWeek: 200 }),

    // ---------- МЯСО, ПРОДОЛЖЕНИЕ ----------
    P('turkey_fillet', 'Индейка, филе', 'meat', 1000, 'кг', true, 549, 104, 19.2, 3.0, 0, { life: 3, grp: 'prot_meat', role: 'protein' }),
    P('chicken_hearts', 'Сердечки куриные', 'meat', 1000, 'кг', true, 369, 159, 15.8, 10.3, 0.8, { life: 2, grp: 'prot_meat', role: 'protein', maxWeek: 350 }),

    // ---------- ОВОЩИ И ЗЕЛЕНЬ, ПРОДОЛЖЕНИЕ ----------
    P('pumpkin', 'Тыква', 'veg', 1000, 'кг', true, 79, 22, 1.0, 0.1, 4.4, { life: 60, wst: 0.3, grp: 'veg_base', role: 'veg' }),
    P('eggplant', 'Баклажан', 'veg', 1000, 'кг', true, 219, 24, 1.2, 0.1, 4.5, { life: 10, wst: 0.1, grp: 'veg_fresh', role: 'veg' }),
    P('radish', 'Редис', 'veg', 1000, 'кг', true, 189, 20, 1.2, 0.1, 3.4, { life: 7, wst: 0.15, grp: 'veg_fresh', role: 'veg' }),
    P('lettuce', 'Салат листовой', 'veg', 150, 'упак. 150 г', false, 129, 15, 1.4, 0.2, 2.0, { life: 5, grp: 'veg_fresh', role: 'veg' }),
    P('green_onion', 'Лук зелёный', 'veg', 100, 'пучок 100 г', false, 79, 19, 1.3, 0.1, 3.2, { life: 5, grp: null, role: 'veg' }),
    P('olives', 'Оливки', 'veg', 300, 'банка 300 г', false, 189, 115, 0.8, 10.7, 6.3, { life: 720, grp: null, role: 'fat', maxWeek: 200 }),
    P('squash_caviar', 'Икра кабачковая', 'veg', 460, 'банка 460 г', false, 149, 97, 1.2, 7.0, 7.4, { life: 720, grp: null, role: 'veg' }),

    // ---------- БАКАЛЕЯ, ПРОДОЛЖЕНИЕ ----------
    P('breadcrumbs', 'Сухари панировочные', 'grocery', 400, 'пачка 400 г', false, 89, 347, 11.0, 2.0, 72.0, { life: 365, grp: null, role: 'carb' }),
    P('starch', 'Крахмал', 'grocery', 200, 'пачка 200 г', false, 69, 320, 0.1, 0, 79.0, { life: 720, grp: null, role: 'carb' }),
    P('mustard', 'Горчица', 'grocery', 150, 'банка 150 г', false, 69, 143, 9.9, 5.3, 12.7, { life: 365, grp: 'sauce', role: 'other' }),
    P('jam', 'Варенье', 'grocery', 400, 'банка 400 г', false, 229, 271, 0.3, 0.1, 68.0, { life: 720, grp: 'sweet', role: 'carb', maxWeek: 200 }),
    P('granola', 'Гранола / мюсли', 'grain', 400, 'пачка 400 г', false, 259, 410, 9.0, 12.0, 63.0, { life: 240, grp: 'carb_grain', role: 'carb' }),
    P('ice_cream', 'Мороженое', 'dairy', 400, 'упак. 400 г', false, 239, 232, 3.5, 12.0, 27.0, { life: 180, grp: 'sweet', role: 'fat', maxWeek: 250 }),
    P('pryaniki', 'Пряники', 'grocery', 350, 'упак. 350 г', false, 129, 364, 4.8, 2.8, 77.0, { life: 180, grp: 'sweet', role: 'carb', maxWeek: 250 }),
    P('bun_burger', 'Булочки для бургера', 'bakery', 300, 'упак. 4 шт', false, 129, 280, 8.0, 5.0, 50.0, { life: 7, piece: 75, grp: 'bread', role: 'carb' }),
    P('bouillon_cube', 'Бульонные кубики', 'grocery', 100, 'упак. 100 г', false, 99, 200, 10.0, 12.0, 12.0, { life: 720, grp: 'spice', role: 'other' }),

    // ---------- БЫТОВАЯ ХИМИЯ И ГИГИЕНА (без БЖУ, но с ценой) ----------
    P('dish_soap', 'Средство для посуды', 'household', 900, 'бутылка 900 мл', false, 189, 0, 0, 0, 0, { unit: 'ml', life: 720, role: 'nonfood' }),
    P('laundry', 'Гель для стирки', 'household', 1300, 'бутылка 1,3 л', false, 449, 0, 0, 0, 0, { unit: 'ml', life: 720, role: 'nonfood' }),
    P('toilet_paper', 'Туалетная бумага', 'household', 8, 'упак. 8 рулонов', false, 219, 0, 0, 0, 0, { life: 1800, role: 'nonfood' }),
    P('trash_bags', 'Пакеты для мусора', 'household', 30, 'рулон 30 шт', false, 129, 0, 0, 0, 0, { life: 1800, role: 'nonfood' }),
    P('shampoo', 'Шампунь', 'household', 400, 'флакон 400 мл', false, 329, 0, 0, 0, 0, { unit: 'ml', life: 720, role: 'nonfood' }),
    P('soap', 'Мыло / гель для душа', 'household', 400, 'флакон 400 мл', false, 249, 0, 0, 0, 0, { unit: 'ml', life: 720, role: 'nonfood' }),
    P('toothpaste', 'Зубная паста', 'household', 100, 'тюбик 100 мл', false, 189, 0, 0, 0, 0, { unit: 'ml', life: 720, role: 'nonfood' }),
    P('sponges', 'Губки / тряпки', 'household', 5, 'упак. 5 шт', false, 89, 0, 0, 0, 0, { life: 1800, role: 'nonfood' })
  ];

  const CATEGORIES = {
    meat: 'Мясо и птица',
    fish: 'Рыба',
    dairy: 'Молочка и яйца',
    grain: 'Крупы, макароны, мука',
    veg: 'Овощи',
    fruit: 'Фрукты',
    bakery: 'Хлеб',
    grocery: 'Бакалея',
    household: 'Бытовая химия и гигиена'
  };

  // Порядок обхода магазина — в этом порядке печатается список покупок
  const CATEGORY_ORDER = ['veg', 'fruit', 'meat', 'fish', 'dairy', 'bakery', 'grain', 'grocery', 'household'];

  const SEED_PRICE_DATE = '2026-08-01';

  window.App = window.App || {};
  window.App.seedProducts = PRODUCTS.map(p => Object.assign({}, p, { pd: SEED_PRICE_DATE, seed: true }));
  window.App.CATEGORIES = CATEGORIES;
  window.App.CATEGORY_ORDER = CATEGORY_ORDER;
  window.App.SEED_PRICE_DATE = SEED_PRICE_DATE;
})();
