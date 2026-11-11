// The method registry supplies all labels. Measurements are validated finite numbers.
export function resultTableCsv(report) {
  const {result, method, source} = report;
  const columns = result.columns ?? ['Quantity', 'Value'];
  const values = result.data ?? Object.entries(result.metrics);
  const lines = [['Method', 'Data source', ...columns], ...values.map(row => [method, source, ...row])];
  return lines.map(row => row.map(value => {
    if (value === null) return '';
    if (typeof value === 'number') return String(value);
    return '"' + value.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n') + '\r\n';
}
