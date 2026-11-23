module.exports = ({ config }) => {
  const projectId = config.extra?.eas?.projectId;
  if (!projectId) {
    if (process.env.EAS_BUILD === 'true') {
      throw new Error('Vincule o projeto com eas init antes de gerar uma build.');
    }
    return config;
  }
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(projectId)) {
    throw new Error('O ID do projeto EAS precisa ser um UUID válido.');
  }
  return {
    ...config,
    runtimeVersion: { policy: 'fingerprint' },
    updates: {
      ...config.updates,
      url: `https://u.expo.dev/${projectId}`,
      checkAutomatically: 'NEVER',
      fallbackToCacheTimeout: 0,
    },
  };
};
