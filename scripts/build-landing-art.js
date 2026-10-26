const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const repositoryRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repositoryRoot, 'frontend', 'data', 'landing-art.json');
const defaultGeoJsonUrl = 'https://gis.naeb.gov.rw/server/rest/services/Hosted/Administrative_Boundaries_WFL1/FeatureServer/0/query?where=1%3D1&outFields=district%2Ccode_dist%2Cname&returnGeometry=true&outSR=4326&maxAllowableOffset=0.001&f=geojson';
const seed = 0x4953554b;
const artboard = { width: 1200, height: 760, map: { left: 500, top: 120, width: 555, height: 560 } };

function projectCoordinate([longitude, latitude], centerLatitude) {
  return [longitude * Math.cos(centerLatitude * Math.PI / 180), -latitude];
}

function boundsOf(points) {
  return points.reduce((bounds, [x, y]) => ({
    minX: Math.min(bounds.minX, x), minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x), maxY: Math.max(bounds.maxY, y)
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function perpendicularDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const amount = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - start[0] - amount * dx, point[1] - start[1] - amount * dy);
}

function simplifyOpenLine(points, tolerance) {
  if (points.length <= 2) return points;
  let farthest = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index], points[0], points.at(-1));
    if (distance > farthest) { farthest = distance; splitIndex = index; }
  }
  if (farthest <= tolerance) return [points[0], points.at(-1)];
  const left = simplifyOpenLine(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyOpenLine(points.slice(splitIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function simplifyRing(points, tolerance = 0.0011) {
  if (points.length < 5) return points;
  const open = points.slice(0, -1);
  let farthest = 0;
  let opposite = Math.floor(open.length / 2);
  for (let index = 1; index < open.length; index += 1) {
    const distance = Math.hypot(open[index][0] - open[0][0], open[index][1] - open[0][1]);
    if (distance > farthest) { farthest = distance; opposite = index; }
  }
  const left = simplifyOpenLine(open.slice(0, opposite + 1), tolerance);
  const right = simplifyOpenLine([...open.slice(opposite), open[0]], tolerance);
  const result = [...left.slice(0, -1), ...right];
  result[result.length - 1] = result[0];
  return result;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let first = 0, last = ring.length - 1; first < ring.length; last = first, first += 1) {
    const [x1, y1] = ring[first];
    const [x2, y2] = ring[last];
    const crosses = (y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1 || Number.EPSILON) + x1;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, rings) {
  return Boolean(rings.length && pointInRing(point, rings[0]) && !rings.slice(1).some((ring) => pointInRing(point, ring)));
}

function pointInPolygons(point, polygons) {
  return polygons.some((rings) => pointInPolygon(point, rings));
}

function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return area / 2;
}

function ringCentroid(ring) {
  let crossSum = 0;
  let xSum = 0;
  let ySum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = x1 * y2 - x2 * y1;
    crossSum += cross;
    xSum += (x1 + x2) * cross;
    ySum += (y1 + y2) * cross;
  }
  if (Math.abs(crossSum) < 1e-12) return ring[0];
  return [xSum / (3 * crossSum), ySum / (3 * crossSum)];
}

function closestBoundaryDistance(point, rings) {
  let closest = Infinity;
  for (const ring of rings) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      closest = Math.min(closest, perpendicularDistance(point, ring[index], ring[index + 1]));
    }
  }
  return closest;
}

function findInteriorLabel(polygons, searchSteps = 48) {
  const outerRings = polygons.map((rings) => rings[0]).filter(Boolean);
  const bounds = boundsOf(outerRings.flat());
  let best = null;
  let bestClearance = -1;
  for (let row = 1; row < searchSteps; row += 1) {
    for (let column = 1; column < searchSteps; column += 1) {
      const point = [
        bounds.minX + (bounds.maxX - bounds.minX) * column / searchSteps,
        bounds.minY + (bounds.maxY - bounds.minY) * row / searchSteps
      ];
      const containingPolygon = polygons.find((rings) => pointInPolygon(point, rings));
      if (!containingPolygon) continue;
      const clearance = closestBoundaryDistance(point, containingPolygon);
      if (clearance > bestClearance) { best = point; bestClearance = clearance; }
    }
  }
  if (!best || !pointInPolygons(best, polygons)) throw new Error('Could not produce a guaranteed interior label point.');
  return best;
}

function mapPoint([x, y]) {
  return [artboard.map.left + x * artboard.map.width, artboard.map.top + y * artboard.map.height];
}

function pathForRings(rings) {
  return rings.map((ring) => {
    const points = ring.map(mapPoint);
    return points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z';
  }).join('');
}

function createDistricts(geoJson) {
  const features = (geoJson.features || []).filter((feature) => feature.geometry && ['Polygon', 'MultiPolygon'].includes(feature.geometry.type));
  if (features.length !== 30) throw new Error(`Expected 30 Rwanda district polygons; received ${features.length}.`);
  const allCoordinates = features.flatMap((feature) => {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return polygons.flat(2);
  });
  const centerLatitude = allCoordinates.reduce((sum, point) => sum + point[1], 0) / allCoordinates.length;
  const projected = allCoordinates.map((point) => projectCoordinate(point, centerLatitude));
  const bounds = boundsOf(projected);
  const rangeX = bounds.maxX - bounds.minX;
  const rangeY = bounds.maxY - bounds.minY;
  const project = (coordinate) => {
    const [x, y] = projectCoordinate(coordinate, centerLatitude);
    const side = Math.max(rangeX, rangeY);
    return [(x - (bounds.minX + bounds.maxX) / 2) / side + 0.5, (y - (bounds.minY + bounds.maxY) / 2) / side + 0.5];
  };
  const districts = features.map((feature) => {
    const name = feature.properties?.district || feature.properties?.name;
    const code = String(feature.properties?.code_dist ?? '');
    if (!name || !code) throw new Error('District GeoJSON must contain district and code_dist properties.');
    const sourcePolygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const polygons = sourcePolygons.map((polygon) => polygon.map((ring) => {
      const normalized = ring.map(project);
      return simplifyRing(normalized).map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]);
    }));
    const largest = [...polygons].sort((left, right) => Math.abs(ringArea(right[0])) - Math.abs(ringArea(left[0])))[0];
    const centroid = ringCentroid(largest[0]);
    let labelPoint;
    try {
      labelPoint = findInteriorLabel(polygons);
    } catch (error) {
      throw new Error(`${name}: ${error.message}`);
    }
    return {
      code,
      name: String(name),
      centroid: centroid.map((value) => Number(value.toFixed(6))),
      labelPoint,
      polygons,
      path: polygons.map(pathForRings).join('')
    };
  });
  if (new Set(districts.map((district) => district.code)).size !== 30) throw new Error('District GeoJSON codes are not unique.');
  if (new Set(districts.map((district) => district.name.toLowerCase())).size !== 30) throw new Error('District GeoJSON names are not unique.');
  return districts;
}

function pointSegmentDistance(point, first, second) {
  return perpendicularDistance(point, first, second);
}

function districtAdjacency(districts) {
  const adjacent = [];
  for (let first = 0; first < districts.length; first += 1) {
    for (let second = first + 1; second < districts.length; second += 1) {
      let minimum = Infinity;
      for (const firstPoly of districts[first].polygons) {
        for (const firstRing of firstPoly) {
          for (const secondPoly of districts[second].polygons) {
            for (const secondRing of secondPoly) {
              for (let a = 0; a < firstRing.length - 1; a += 1) {
                for (let b = 0; b < secondRing.length - 1; b += 1) {
                  minimum = Math.min(minimum,
                    pointSegmentDistance(firstRing[a], secondRing[b], secondRing[b + 1]),
                    pointSegmentDistance(firstRing[a + 1], secondRing[b], secondRing[b + 1]),
                    pointSegmentDistance(secondRing[b], firstRing[a], firstRing[a + 1]),
                    pointSegmentDistance(secondRing[b + 1], firstRing[a], firstRing[a + 1]));
                  if (minimum < 1e-5) break;
                }
                if (minimum < 1e-5) break;
              }
              if (minimum < 1e-5) break;
            }
            if (minimum < 1e-5) break;
          }
          if (minimum < 1e-5) break;
        }
        if (minimum < 1e-5) break;
      }
      if (minimum < 0.0025) adjacent.push([first, second]);
    }
  }
  return adjacent;
}

function hungarian(costs) {
  const rowCount = costs.length;
  const columnCount = costs[0]?.length || 0;
  if (!rowCount || rowCount > columnCount) throw new Error('Hex assignment needs at least as many candidate cells as districts.');
  const u = Array(rowCount + 1).fill(0);
  const v = Array(columnCount + 1).fill(0);
  const matchedRow = Array(columnCount + 1).fill(0);
  const path = Array(columnCount + 1).fill(0);
  for (let row = 1; row <= rowCount; row += 1) {
    matchedRow[0] = row;
    let column0 = 0;
    const minimum = Array(columnCount + 1).fill(Infinity);
    const used = Array(columnCount + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = matchedRow[column0];
      let delta = Infinity;
      let column1 = 0;
      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) continue;
        const current = costs[row0 - 1][column - 1] - u[row0] - v[column];
        if (current < minimum[column]) { minimum[column] = current; path[column] = column0; }
        if (minimum[column] < delta) { delta = minimum[column]; column1 = column; }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) { u[matchedRow[column]] += delta; v[column] -= delta; }
        else minimum[column] -= delta;
      }
      column0 = column1;
    } while (matchedRow[column0] !== 0);
    do {
      const column1 = path[column0];
      matchedRow[column0] = matchedRow[column1];
      column0 = column1;
    } while (column0 !== 0);
  }
  const assignment = Array(rowCount);
  for (let column = 1; column <= columnCount; column += 1) {
    if (matchedRow[column]) assignment[matchedRow[column] - 1] = column - 1;
  }
  return assignment;
}

function hexDistance(first, second) {
  const q = first.q - second.q;
  const r = first.r - second.r;
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

function assignHexes(districts) {
  const candidates = [];
  const columns = 6;
  const rows = 6;
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const axialR = row - (column - (column & 1)) / 2;
      candidates.push({ q: column, r: axialR, x: column / (columns - 1), y: (row + (column & 1) * 0.5) / (rows - 0.5) });
    }
  }
  const longitudeRanks = averageRanks(districts.map((district) => district.centroid[0]));
  const latitudeRanks = averageRanks(districts.map((district) => district.centroid[1]));
  const candidateLongitudeRanks = averageRanks(candidates.map((candidate) => candidate.x));
  const candidateLatitudeRanks = averageRanks(candidates.map((candidate) => candidate.y));
  const costs = districts.map((district, districtIndex) => candidates.map((candidate, candidateIndex) => {
    const dx = district.centroid[0] - candidate.x;
    const dy = district.centroid[1] - candidate.y;
    const rankX = (longitudeRanks[districtIndex] - candidateLongitudeRanks[candidateIndex]) / districts.length;
    const rankY = (latitudeRanks[districtIndex] - candidateLatitudeRanks[candidateIndex]) / districts.length;
    return dx * dx + dy * dy + 1000 * (rankX * rankX + rankY * rankY);
  }));
  let assignment = hungarian(costs);
  const adjacencies = districtAdjacency(districts);
  const objective = (candidateAssignment) => {
    const cells = candidateAssignment.map((candidateIndex) => candidates[candidateIndex]);
    const longitude = rankCorrelation(districts.map((district) => district.centroid[0]), cells.map((cell) => cell.x));
    const latitude = rankCorrelation(districts.map((district) => district.centroid[1]), cells.map((cell) => cell.y));
    let adjacencyPenalty = 0;
    adjacencies.forEach(([first, second]) => {
      const distance = hexDistance(cells[first], cells[second]);
      if (distance > 2) adjacencyPenalty += (distance - 2) ** 2;
    });
    const spatialPenalty = candidateAssignment.reduce((sum, candidateIndex, districtIndex) => {
      const dx = districts[districtIndex].centroid[0] - candidates[candidateIndex].x;
      const dy = districts[districtIndex].centroid[1] - candidates[candidateIndex].y;
      return sum + dx * dx + dy * dy;
    }, 0) / districts.length;
    return Math.min(longitude, latitude) + 0.1 * (longitude + latitude) - adjacencyPenalty * 0.025 - spatialPenalty * 0.005;
  };
  const random = seededRandom(seed ^ 0x48455831);
  let currentAssignment = [...assignment];
  let currentScore = objective(currentAssignment);
  let bestAssignment = [...currentAssignment];
  let bestScore = currentScore;
  const iterations = 2000000;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const first = Math.floor(random() * currentAssignment.length);
    let second = Math.floor(random() * (currentAssignment.length - 1));
    if (second >= first) second += 1;
    [currentAssignment[first], currentAssignment[second]] = [currentAssignment[second], currentAssignment[first]];
    const candidateScore = objective(currentAssignment);
    const temperature = 0.035 * (1 - iteration / iterations) + 0.00015;
    if (candidateScore >= currentScore || random() < Math.exp((candidateScore - currentScore) / temperature)) {
      currentScore = candidateScore;
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestAssignment = [...currentAssignment];
      }
    } else {
      [currentAssignment[first], currentAssignment[second]] = [currentAssignment[second], currentAssignment[first]];
    }
  }
  assignment = bestAssignment;
  const layoutMetrics = (candidateAssignment) => {
    const cells = candidateAssignment.map((candidateIndex) => candidates[candidateIndex]);
    const longitude = rankCorrelation(districts.map((district) => district.centroid[0]), cells.map((cell) => cell.x));
    const latitude = rankCorrelation(districts.map((district) => district.centroid[1]), cells.map((cell) => cell.y));
    const violations = adjacencies.filter(([first, second]) => hexDistance(cells[first], cells[second]) > 2).length;
    return { longitude, latitude, violations };
  };
  let currentMetrics = layoutMetrics(assignment);
  while (currentMetrics.violations > 0) {
    let repair = null;
    for (let first = 0; first < assignment.length; first += 1) {
      for (let second = first + 1; second < assignment.length; second += 1) {
        [assignment[first], assignment[second]] = [assignment[second], assignment[first]];
        const metrics = layoutMetrics(assignment);
        if (metrics.longitude >= 0.95 && metrics.latitude >= 0.95 && metrics.violations < currentMetrics.violations) {
          const score = objective(assignment);
          if (!repair || metrics.violations < repair.metrics.violations || (metrics.violations === repair.metrics.violations && score > repair.score)) {
            repair = { assignment: [...assignment], metrics, score };
          }
        }
        [assignment[first], assignment[second]] = [assignment[second], assignment[first]];
      }
    }
    if (!repair) break;
    assignment = repair.assignment;
    currentMetrics = repair.metrics;
  }
  const layout = districts.map((district, index) => ({ ...district, hex: candidates[assignment[index]] }));
  const violations = adjacencies
    .map(([first, second]) => ({ first: districts[first].name, second: districts[second].name, distance: hexDistance(layout[first].hex, layout[second].hex) }))
    .filter((pair) => pair.distance > 2);
  return { layout, adjacencies, violations };
}

function averageRanks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const ranks = Array(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[sorted[index].index] = rank;
    start = end;
  }
  return ranks;
}

function rankCorrelation(first, second) {
  const left = averageRanks(first);
  const right = averageRanks(second);
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / left.length;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSquare = 0;
  let rightSquare = 0;
  for (let index = 0; index < left.length; index += 1) {
    const dx = left[index] - meanLeft;
    const dy = right[index] - meanRight;
    numerator += dx * dy;
    leftSquare += dx * dx;
    rightSquare += dy * dy;
  }
  return numerator / Math.sqrt(leftSquare * rightSquare);
}

function createHexLayout(districts) {
  const { layout, adjacencies, violations } = assignHexes(districts);
  const longitudeCorrelation = rankCorrelation(layout.map((district) => district.centroid[0]), layout.map((district) => district.hex.x));
  const latitudeCorrelation = rankCorrelation(layout.map((district) => district.centroid[1]), layout.map((district) => district.hex.y));
  if (new Set(layout.map((district) => `${district.hex.q},${district.hex.r}`)).size !== 30) throw new Error('Hex layout does not assign 30 distinct cells.');
  if (longitudeCorrelation < 0.95 || latitudeCorrelation < 0.95) throw new Error(`Hex layout rank correlation failed (${longitudeCorrelation.toFixed(3)}, ${latitudeCorrelation.toFixed(3)}).`);
  if (violations.length) throw new Error(`Hex layout has ${violations.length} neighboring district pair(s) more than two hex steps apart: ${violations.map(({ first, second, distance }) => `${first}/${second} (${distance})`).join(', ')}.`);
  return { layout, validation: { longitudeCorrelation, latitudeCorrelation, sharedBorderPairs: adjacencies.length, maximumNeighborSteps: violations.reduce((maximum, item) => Math.max(maximum, item.distance), 0) } };
}

function seededRandom(initialSeed = seed) {
  let value = initialSeed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

function smoothNoise(x, y, phase) {
  const first = Math.sin((x * 2.1 + y * 1.1 + phase) * Math.PI * 2);
  const second = Math.sin((y * 2.8 - x * 0.7 + phase * 1.7) * Math.PI * 2);
  const third = Math.cos((x * 1.2 + y * 2.4 - phase * 0.6) * Math.PI * 2);
  return (first + second + third) / 3;
}

function interpolateCrossing(first, second, firstValue, secondValue, level) {
  const amount = (level - firstValue) / (secondValue - firstValue || 1e-9);
  return [first[0] + (second[0] - first[0]) * amount, first[1] + (second[1] - first[1]) * amount];
}

function stitchSegments(segments, width, height) {
  const quantize = (point) => `${Math.round(point[0] * 1000)},${Math.round(point[1] * 1000)}`;
  const adjacency = new Map();
  segments.forEach((segment, index) => segment.forEach((point) => {
    const key = quantize(point);
    const linked = adjacency.get(key) || [];
    linked.push(index);
    adjacency.set(key, linked);
  }));
  const used = new Set();
  const paths = [];
  const toArt = ([x, y]) => [x / width * artboard.width, y / height * artboard.height];
  for (let index = 0; index < segments.length; index += 1) {
    if (used.has(index)) continue;
    used.add(index);
    const path = [segments[index][0], segments[index][1]];
    let current = quantize(segments[index][1]);
    while (true) {
      const next = (adjacency.get(current) || []).find((candidate) => !used.has(candidate));
      if (next === undefined) break;
      used.add(next);
      const segment = segments[next];
      const point = quantize(segment[0]) === current ? segment[1] : segment[0];
      path.push(point);
      current = quantize(point);
    }
    const points = path.map(toArt);
    if (points.length > 1) paths.push(points.map(([x, y], pointIndex) => `${pointIndex ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(''));
  }
  return paths.join('');
}

function contourAtLevel(values, width, height, level) {
  const segments = [];
  const edgePairs = [[0, 1], [1, 2], [2, 3], [3, 0]];
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const points = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
      const samples = [values[y][x], values[y][x + 1], values[y + 1][x + 1], values[y + 1][x]];
      const crossings = [];
      edgePairs.forEach(([first, second], edgeIndex) => {
        if ((samples[first] < level) === (samples[second] < level)) return;
        crossings.push({ edgeIndex, point: interpolateCrossing(points[first], points[second], samples[first], samples[second], level) });
      });
      if (crossings.length === 2) segments.push([crossings[0].point, crossings[1].point]);
      else if (crossings.length === 4) {
        const middleHigh = samples.reduce((sum, value) => sum + value, 0) / 4 >= level;
        const pairs = middleHigh ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
        pairs.forEach(([first, second]) => segments.push([crossings[first].point, crossings[second].point]));
      }
    }
  }
  return stitchSegments(segments, width, height);
}

function buildTerrain(districts, width = 120, height = 76) {
  const random = seededRandom();
  const phase = random();
  const polygons = districts.flatMap((district) => district.polygons);
  const rings = polygons.flat();
  const values = Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, column) => {
    const artX = column / (width - 1) * artboard.width;
    const artY = row / (height - 1) * artboard.height;
    const mapX = (artX - artboard.map.left) / artboard.map.width;
    const mapY = (artY - artboard.map.top) / artboard.map.height;
    const point = [mapX, mapY];
    const inside = pointInPolygons(point, polygons);
    const distance = closestBoundaryDistance(point, rings);
    const signedDistance = inside ? distance : -distance;
    const plateau = 0.5 + 0.48 * Math.tanh(signedDistance * 35);
    const noise = smoothNoise(artX / artboard.width, artY / artboard.height, phase) * 0.11;
    return Math.max(0, Math.min(1, plateau + noise));
  }));
  const paths = [];
  for (let index = 0; index < 16; index += 1) {
    const level = 0.06 + index / 15 * 0.88;
    const d = contourAtLevel(values, width, height, level);
    if (d) paths.push({ level: Number(level.toFixed(3)), d });
  }
  const layers = Array.from({ length: 5 }, (_, layer) => paths.filter((_, index) => Math.min(4, Math.floor(index / 4)) === layer));
  return layers.map((contours) => ({ paths: contours }));
}

function buildArtFromGeoJson(geoJson) {
  const districts = createDistricts(geoJson);
  const { layout, validation } = createHexLayout(districts);
  const hexByCode = new Map(layout.map((district) => [district.code, district.hex]));
  districts.forEach((district) => { district.hex = hexByCode.get(district.code); });
  const terrainLayers = buildTerrain(districts);
  return {
    version: 1,
    seed,
    viewBox: artboard,
    terrainLayers,
    districts,
    hexValidation: validation
  };
}

async function readGeoJson() {
  const inputPath = process.env.LANDING_GEOJSON_FILE;
  if (inputPath) return JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const url = process.env.LANDING_GEOJSON_URL || defaultGeoJsonUrl;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`District GeoJSON request failed (${response.status}).`);
  return response.json();
}

async function main() {
  const geoJson = await readGeoJson();
  const art = buildArtFromGeoJson(geoJson);
  const json = JSON.stringify(art);
  const compressedBytes = zlib.gzipSync(json, { level: 9 }).byteLength;
  if (compressedBytes > 110 * 1024) {
    const districtBytes = zlib.gzipSync(JSON.stringify(art.districts), { level: 9 }).byteLength;
    const terrainBytes = zlib.gzipSync(JSON.stringify(art.terrainLayers), { level: 9 }).byteLength;
    throw new Error(`Generated art is ${compressedBytes} gzip bytes (districts ${districtBytes}, terrain ${terrainBytes}); limit is 110 KB.`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${json}\n`);
  process.stdout.write(`Wrote ${path.relative(repositoryRoot, outputPath)} (${Buffer.byteLength(json)} bytes; ${compressedBytes} gzip bytes).\n`);
  process.stdout.write(`Hex validation: lon rho ${art.hexValidation.longitudeCorrelation.toFixed(4)}, lat rho ${art.hexValidation.latitudeCorrelation.toFixed(4)}, ${art.hexValidation.sharedBorderPairs} shared-border pairs.\n`);
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { buildArtFromGeoJson, buildTerrain, assignHexes, createDistricts, pointInPolygon, pointInPolygons, rankCorrelation, simplifyRing };
