const forbiddenImport =
  /^(?:better-auth(?:\/|$)|@better-auth\/|@thallesp\/nestjs-better-auth(?:\/|$)|nodemailer(?:\/|$))/;

export function isForbiddenAuthorizationImport(specifier) {
  return forbiddenImport.test(specifier);
}
