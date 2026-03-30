function toList(array) {
  let list = 0;

  for (let i = array.length - 1; i >= 0; i -= 1) {
    list = { hd: array[i], tl: list };
  }

  return list;
}

function fromList(list) {
  const array = [];
  let current = list;

  while (current) {
    array.push(current.hd);
    current = current.tl;
  }

  return array;
}

export function fromArray(array) {
  return toList(array);
}

export function toArray(list) {
  return fromList(list);
}

export function map(list, fn) {
  return toList(fromList(list).map(fn));
}

export function mapWithIndex(list, fn) {
  return toList(fromList(list).map((value, index) => fn(index, value)));
}

export function forEach(list, fn) {
  let current = list;

  while (current) {
    fn(current.hd);
    current = current.tl;
  }
}

export function concat(left, right) {
  return toList([...fromList(left), ...fromList(right)]);
}

export function reduceU(list, initial, fn) {
  let acc = initial;
  let current = list;

  while (current) {
    acc = fn(acc, current.hd);
    current = current.tl;
  }

  return acc;
}
