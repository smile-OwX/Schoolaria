export function formatFirebaseAuthErrorDetails(
  code: string,
  msg: string,
  origin = ''
): string {
  if (/cancel/i.test(code) || /cancel/i.test(msg) || code === '12501' || code === '16') {
    return 'Connexion annulée avant validation. Réessayez.';
  }
  if (/developer_error|10:|default_web_client_id|no credentials available|sha-1/i.test(msg)) {
    return 'Configuration Android Google Sign-In incomplète : vérifiez que google-services.json et votre empreinte SHA-1 sont bien ajoutés dans Console Firebase pour com.schoolaria.app.';
  }

  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Fenêtre de connexion Google fermée avant validation. Réessayez.';
    case 'auth/cancelled-popup-request':
      return 'Une demande de connexion est déjà en cours.';
    case 'auth/network-request-failed':
      return 'Erreur réseau pendant la connexion. Vérifiez votre accès Internet.';
    case 'auth/unauthorized-domain':
      return `Domaine non autorisé dans Firebase Auth (${origin || 'inconnu'}). Ajoutez ce domaine dans Console Firebase → Authentication → Settings → Authorized domains.`;
    case 'auth/operation-not-supported-in-this-environment':
      return 'Cet environnement bloque les fenêtres popup : bascule en mode redirection en cours...';
    case 'auth/operation-not-allowed':
      return 'La connexion par E-mail et Mot de passe n’est pas encore activée dans Firebase Console → Authentication → Sign-in method.';
    case 'auth/email-already-in-use':
      return 'Un compte existe déjà avec cet e-mail. Cliquez sur « Déjà inscrit · Se connecter » ou sur « Mot de passe oublié ? » pour définir un nouveau mot de passe.';
    case 'auth/invalid-email':
      return 'Adresse e-mail invalide. Vérifiez le format saisi (ex : nom@yahoo.fr, nom@outlook.com).';
    case 'auth/weak-password':
      return 'Mot de passe trop faible : utilisez au moins 6 caractères.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'E-mail ou mot de passe incorrect. Si c’est votre 1ère connexion (l’école a ajouté votre e-mail sans mot de passe), cliquez sur « 1ère connexion · Créer mon mot de passe ».';
    case 'auth/too-many-requests':
      return 'Trop de tentatives en peu de temps. Patientez quelques minutes avant de réessayer.';
    case 'auth/credential-already-in-use':
      return 'Ce compte Google est déjà associé à un autre profil Schoolaria.';
    case 'auth/provider-already-linked':
      return 'Votre compte Google est déjà lié à ce profil.';
    default:
      return msg || 'Échec de l’authentification.';
  }
}
