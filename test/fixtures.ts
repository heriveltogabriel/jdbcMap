// Exportação sintética no formato do Java Assessment (nada de dados de cliente).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export function syntheticExport(): Row {
  const environments = [
    { id: 'env-1', name: 'Desenvolvimento' },
    { id: 'env-2', name: 'Producao' },
  ];
  const hosts = [
    { id: 'h1', environmentId: 'env-1', hostname: 'n121d004775', distribution: 'Red Hat Enterprise Linux Server release 7.2 (Maipo)' },
    { id: 'h2', environmentId: 'env-1', hostname: 'srv1h137.example.net', distribution: 'Red Hat Enterprise Linux release 8.9 (Ootpa)' },
    { id: 'h3', environmentId: 'env-2', hostname: 'n121p000001', distribution: 'Red Hat Enterprise Linux release 9.4 (Plow)' },
    { id: 'h4', environmentId: 'env-1', hostname: 'hprouing-master-0', distribution: 'Red Hat Enterprise Linux release 9.4 (Plow)' },
  ];
  const servers = [
    { id: 's1', hostId: 'h1', type: 'WebLogic', version: '12.2.1.4.0' },
  ];
  const processes = [
    { hostId: 'h1', pid: 100, javaVersion: '1.8.0_251', serverType: 'WebLogic' },
    { hostId: 'h2', pid: 200, javaVersion: '17.0.7', applicationType: 'Spring Boot', applicationId: 'a2' },
    { hostId: 'h3', pid: 300, javaVersion: '1.8.0_471', serverType: 'WebLogic' },
  ];
  const applications = [{ id: 'a2', hostId: 'h2', applicationType: 'Spring Boot', frameworkVersion: '3.4.3' }];
  const datasources = [
    {
      id: 'd1', hostId: 'h1', name: 'OrdersDS', databaseType: 'Oracle', databaseHost: 'dbscan1.example.net', databasePort: 1521, databaseName: 'orders',
      associations: [{ pid: 100, serverId: 's1', driverResult: { driverResolution: 'IDENTIFIED', driverVersion: '11.2.0.4.0', driverArtifact: '/u01/lib/ojdbc6.jar', driverFamily: 'ojdbc6 (JDK 6)' } }],
    },
    {
      id: 'd2', hostId: 'h2', name: 'api datasource', databaseType: 'Oracle', databaseHost: '10.1.2.3', databasePort: 1521, databaseName: 'API',
      driverVersion: '23.7.0.25.01', driverArtifact: '/app.jar!/BOOT-INF/lib/ojdbc11-23.7.0.25.01.jar',
      associations: [{ pid: 200, applicationId: 'a2' }],
    },
    {
      id: 'd3', hostId: 'h3', name: 'Unresolved', databaseType: 'Oracle', databaseHost: 'dbscan2.example.net', databasePort: 1521, databaseName: 'bill',
      driverResolution: 'INCOMPLETE', driverResolutionReason: 'Argumentos da JVM truncados nos metadados hsperfdata; opções adicionais não confirmadas',
      associations: [{ pid: 300 }],
    },
    { id: 'd4', hostId: 'h4', name: 'h2 db', databaseType: 'H2', databaseHost: null },
  ];
  return {
    metadata: {
      format: 'java-assessment-inventory', formatVersion: 2, dashboardVersion: '2.1.22', exportedAt: '2026-10-26T12:00:00Z',
      label: 'teste', scope: 'all-current-inventory', containsCredentials: false,
      counts: { environments: 2, hosts: 4, datasources: 4 },
    },
    data: { environments, hosts, servers, processes, applications, datasources, runtimes: [], libraries: [] },
  };
}
