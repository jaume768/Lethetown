/**
 * Nombres de pila corrientes en España y en Mallorca hacia 2002 (castellanos, catalanes y
 * mallorquines, con sus diminutivos), para que el `PersonGuard` reconozca a una persona aunque
 * no lleve artículo («me lo dijo Pepa»). Se amplía con `personGuard.extraGivenNames` de la
 * biblia. Normalizados al comparar (sin tildes).
 */
export const GIVEN_NAMES = `
Aarón Abel Abril Adela Adelaida Adolfo Adrián Adriana Agustí Agustín Agustina Aina Alba Albert
Alberto Alejandra Alejandro Alfonso Alfredo Alicia Alma Álvaro Amadeo Amalia Amparo Ana Anabel
Andreu Ángel Ángela Angélica Anna Antonia Antònia Antonio Antoni Apol·lònia Araceli Arantxa
Ariadna Armando Arnau Arturo Asunción Aurelio Bàrbara Bárbara Bartolomé Bartomeu Beatriz Begoña
Belén Benito Bernat Bernardo Berta Biel Blai Borja Bruno Caetano Caridad Carla Carles Carlos
Carlota Carolina Catalina Cayetano Cecilia Celia César Charo Chelo Chema Chimo Cinta Clemente
Cloe Coloma Concepción Concha Conchita Consuelo Cristina Cristóbal Cristòfol Damià Damián Daniel
Daniela David Diego Dionisio Dolores Dulce Eduardo Elisa Elisabet Eloy Eladio Elvira
Emilia Emilio Encarna Encarnación Enric Enrique Enriqueta Esperanza Esteban Esteve Estrella
Eugenia Eugenio Eulalia Eusebio Eva Fabián Federico Felipe Felisa Fermín Fernando Fina Francesc
Francesca Francina Francisca Francisco Fran Gabriel Gaspar Gema Gerardo Gertrudis Gloria
Gonzalo Gregorio Guadalupe Guillem Guillermo Gustavo Héctor Helena Herminia Higinio Hilario
Ignacio Ignasi Inmaculada Inma Irene Isaac Isabel Isidro Iván Jacinto Jacobo Jaime Jaume Javier
Jeroni Jerónimo Joan Joana Joaquim Joaquín Jordi Jorge Josefa Josefina José Josep Juan Juana
Juanjo Juanma Judit Julia Julio Lali Laura Leonor Leopoldo Lidia Llorenç Lluc Lluís Lola Lorena
Lorenzo Lourdes Lucas Luis Luisa Magdalena Maite Manolo Manuel Manuela Manu Marc Marcos Margalida
Margarita Mari Maria María Mariano Marina Mario Marisa Marisol Marta Martí Martín Matías Maximino
Mercè Merche Micaela Miguel Miquel Mireia Moisés Montse Montserrat Nacho Nando Natalia Neus
Nicolás Nieves Noelia Norberto Núria Óscar Pablo Paca Paco Pau Paula Paulina Pedro Pep Pepa Pepe
Pepi Pepita Pere Petra Pili Pilar Pío Quim Quique Rafa Rafel Rafael Raimundo Ramón Ramona Raquel
Raúl Rebeca Remedios Ricardo Rita Roberto Rocío Rodrigo Rosa Rosalía Rosario Rubén Sagrario
Salvador Sandra Santi Santiago Sara Sebastià Sebastián Sergio Sílvia Silvia Simón Sonia Susana
Teresa Tere Tòfol Tolo Tomàs Tomás Tomeu Toni Trini Ulises Valentín Vanesa Verónica Vicenç Vicente
Vicenta Víctor Victoria Virginia Xavi Xavier Xesc Xim Xisca Xisco Yolanda Zoe
`
  .split(/\s+/)
  .filter(Boolean);
