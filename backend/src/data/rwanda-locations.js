const rwandaLocations = [
  { district: 'Musanze', province: 'Northern Province', country: 'Rwanda', latitude: -1.4998, longitude: 29.6347 },
  { district: 'Rubavu', province: 'Western Province', country: 'Rwanda', latitude: -1.6773, longitude: 29.2574 },
  { district: 'Huye', province: 'Southern Province', country: 'Rwanda', latitude: -2.5967, longitude: 29.7394 },
  { district: 'Nyagatare', province: 'Eastern Province', country: 'Rwanda', latitude: -1.2928, longitude: 30.3254 },
  { district: 'Bugesera', province: 'Eastern Province', country: 'Rwanda', latitude: -2.1354, longitude: 30.1468 },
  { district: 'Gatsibo', province: 'Eastern Province', country: 'Rwanda', latitude: -1.5711, longitude: 30.4347 },
  { district: 'Kayonza', province: 'Eastern Province', country: 'Rwanda', latitude: -1.9075, longitude: 30.4846 },
  { district: 'Kirehe', province: 'Eastern Province', country: 'Rwanda', latitude: -2.2639, longitude: 30.6475 },
  { district: 'Ngoma', province: 'Eastern Province', country: 'Rwanda', latitude: -2.1597, longitude: 30.5281 },
  { district: 'Rwamagana', province: 'Eastern Province', country: 'Rwanda', latitude: -1.9487, longitude: 30.4347 },
  { district: 'Burera', province: 'Northern Province', country: 'Rwanda', latitude: -1.4536, longitude: 29.8321 },
  { district: 'Gakenke', province: 'Northern Province', country: 'Rwanda', latitude: -1.6886, longitude: 29.7864 },
  { district: 'Gicumbi', province: 'Northern Province', country: 'Rwanda', latitude: -1.5739, longitude: 30.0675 },
  { district: 'Rulindo', province: 'Northern Province', country: 'Rwanda', latitude: -1.7137, longitude: 29.9992 },
  { district: 'Gisagara', province: 'Southern Province', country: 'Rwanda', latitude: -2.5785, longitude: 29.8123 },
  { district: 'Kamonyi', province: 'Southern Province', country: 'Rwanda', latitude: -2.0035, longitude: 29.9236 },
  { district: 'Muhanga', province: 'Southern Province', country: 'Rwanda', latitude: -2.0852, longitude: 29.7524 },
  { district: 'Nyamagabe', province: 'Southern Province', country: 'Rwanda', latitude: -2.4667, longitude: 29.5811 },
  { district: 'Nyanza', province: 'Southern Province', country: 'Rwanda', latitude: -2.3519, longitude: 29.7509 },
  { district: 'Nyaruguru', province: 'Southern Province', country: 'Rwanda', latitude: -2.5961, longitude: 29.5572 },
  { district: 'Ruhango', province: 'Southern Province', country: 'Rwanda', latitude: -2.2311, longitude: 29.8022 },
  { district: 'Karongi', province: 'Western Province', country: 'Rwanda', latitude: -2.0601, longitude: 29.3478 },
  { district: 'Ngororero', province: 'Western Province', country: 'Rwanda', latitude: -1.8706, longitude: 29.5761 },
  { district: 'Nyabihu', province: 'Western Province', country: 'Rwanda', latitude: -1.5961, longitude: 29.5081 },
  { district: 'Nyamasheke', province: 'Western Province', country: 'Rwanda', latitude: -2.3499, longitude: 29.1674 },
  { district: 'Rusizi', province: 'Western Province', country: 'Rwanda', latitude: -2.4846, longitude: 28.9075 },
  { district: 'Rutsiro', province: 'Western Province', country: 'Rwanda', latitude: -1.9153, longitude: 29.3231 },
  { district: 'Nyarugenge', province: 'Kigali City', country: 'Rwanda', latitude: -1.9536, longitude: 30.0606 },
  { district: 'Gasabo', province: 'Kigali City', country: 'Rwanda', latitude: -1.8946, longitude: 30.1294 },
  { district: 'Kicukiro', province: 'Kigali City', country: 'Rwanda', latitude: -1.9792, longitude: 30.1040 }
];

function findRwandaDistrict(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return rwandaLocations.find((location) => location.district.toLowerCase() === normalized) || null;
}

module.exports = { rwandaLocations, findRwandaDistrict };
