/* ═══════════════════════════════════════════════════════════════════════════
   ТЕЛЕСКОПИЧЕСКИЙ АМОРТИЗАТОР (корпус + шток)

   Модуль без Three.js и DOM — проверяется тестами Node.

   Главная ошибка прежней версии: длина штока была постоянной, а его
   положение считалось по подогнанной формуле. Как только полная длина
   амортизатора вырастала, низ штока выходил выше верха корпуса и шток
   визуально отрывался от цилиндра — висел в воздухе.

   Здесь ведущая величина — НЕ длина штока, а его ГЛУБИНА ПОСАДКИ в корпус.
   Корпус жёстко связан с нижним ушком, верх штока — с верхней опорой,
   а видимая длина штока выводится так, чтобы он ГАРАНТИРОВАННО оставался
   внутри цилиндра не менее чем на minInsertion при любом ходе.

   Цилиндр, в отличие от витой пружины, МОЖНО масштабировать вдоль своей оси:
   сечение лежит в плоскости XZ и остаётся круглым. Поэтому возвращаемая
   длина штока прямо идёт в scale.y без искажений.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Раскладка телескопического узла в местной системе, где y = 0 — нижняя
 * точка крепления, а y = length — верхняя.
 *
 * @param {object} spec
 * @param {number} spec.length        полная длина между точками крепления
 * @param {number} spec.tubeBottom    отступ низа корпуса от нижнего ушка
 * @param {number} spec.tubeLength    длина корпуса (постоянная)
 * @param {number} spec.rodTopInset   насколько верх штока не доходит до верхней точки
 * @param {number} spec.minInsertion  минимальная глубина штока в корпусе
 * @param {number} spec.minRodLength  минимальная видимая длина штока
 */
export function solveTelescopic({
  length,
  tubeBottom = 0,
  tubeLength,
  rodTopInset = 0,
  minInsertion = 0.05,
  minRodLength = 0.06,
}) {
  const tubeTop = tubeBottom + tubeLength;
  const rodTop = length - rodTopInset;

  /* Низ штока не имеет права подняться выше, чем tubeTop - minInsertion:
     именно это условие раньше нарушалось и давало зазор. */
  const insertionLimit = tubeTop - minInsertion;
  const lengthLimit = rodTop - minRodLength;
  const rodBottom = Math.min(insertionLimit, lengthLimit);
  const rodLength = Math.max(minRodLength, rodTop - rodBottom);

  return Object.freeze({
    tubeBottom,
    tubeTop,
    tubeCenter: tubeBottom + tubeLength * 0.5,
    tubeLength,
    rodTop,
    rodBottom,
    rodLength,
    rodCenter: rodTop - rodLength * 0.5,
    /* Сколько штока сидит в корпусе. Всегда >= minInsertion. */
    insertion: tubeTop - rodBottom,
    /* Открытая часть штока над корпусом — её закрывает пыльник. */
    exposed: Math.max(0, rodTop - tubeTop),
  });
}

/**
 * Отбойник и гофрированный пыльник штока. Пыльник закрывает ровно ту часть
 * штока, которая торчит из корпуса, минус сжатый отбойник сверху.
 */
export function solveRodShroud({
  tubeTop,
  rodTop,
  bumpStopFree = 0.075,
  bumpStopMin = 0.026,
  bumpStopCrush = 0,
  bootMin = 0.03,
}) {
  const bumpStopLength = Math.max(
    bumpStopMin,
    bumpStopFree - Math.max(0, bumpStopCrush),
  );
  const bumpStopTop = rodTop;
  const bumpStopBottom = bumpStopTop - bumpStopLength;
  const bootLength = Math.max(bootMin, bumpStopBottom - tubeTop);
  return Object.freeze({
    bumpStopLength,
    bumpStopCenter: bumpStopTop - bumpStopLength * 0.5,
    bootLength,
    bootCenter: tubeTop + bootLength * 0.5,
  });
}
