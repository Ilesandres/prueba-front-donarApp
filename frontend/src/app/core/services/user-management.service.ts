import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface UserManagement {
  id: number;
  username: string;
  email: string;
  token: string | null;
  loginAttempts: number;
  lockUntil: string | null;
  profilePhoto: string;
  dateSendCodigo: string | null;
  lastLogin: string | null;
  emailVerified: boolean;
  verified: boolean;
  code: string | null;
  block: boolean;
  location: string | null;
  people: {
    id: number;
    name: string;
    municipio: string;
    lastName: string | null;
    birdthDate: string;
    typeDni: {
      id: number;
      type: string;
      createdAt: string;
      updatedAt: string;
    };
    dni: string;
    residencia: string;
    telefono: string;
    supportId: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  rol: {
    id: number;
    rol: string;
    createdAt: string;
    updatedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserDTO {
  username?: string;
  email?: string;
  password?: string;
  rolId?: number;
  people?: any; // PeopleEntity
  profilePhoto?: string;
  block?: boolean;
  verificationCode?: string;
  isVerifiedEmail?: boolean;
  verified?: boolean;
}

export interface ChangeRoleDTO {
  roleId: number;
}

export interface ChangeBlockStatusDTO {
  block: boolean;
}

export interface CreateUserDTO {
  username: string;
  email?: string;
  password: string;
  rolId: number;
  people?: {
    name?: string;
    lastName?: string;
    birdthDate?: string;
    tipodDni?: number;
    dni?: string;
    residencia?: string;
    telefono?: string;
    municipio?: {
      pais?: {
        iso2?: string;
      };
      state?: {
        iso2?: string;
      };
      city?: {
        name?: string;
      };
    };
  };
}

@Injectable({
  providedIn: 'root'
})
export class UserManagementService {
  private apiUrl = `${environment.apiBackendUrl}/user`;

  constructor(private http: HttpClient) {}

  getAllUsers(): Observable<UserManagement[]> {
    return this.http.get<UserManagement[]>(this.apiUrl).pipe(
      catchError((error) => {
        console.error('Error fetching users:', error);
        return throwError(() => error);
      })
    );
  }

  getUserById(id: number): Observable<UserManagement> {
    return this.http.get<UserManagement>(`${this.apiUrl}/${id}`).pipe(
      catchError((error) => {
        console.error(`Error fetching user ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  updateUser(id: number, user: UpdateUserDTO): Observable<UserManagement> {
    return this.http.post<UserManagement>(`${this.apiUrl}/update/${id}`, user).pipe(
      catchError((error) => {
        console.error(`Error updating user ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  changeUserRole(id: number, roleId: number): Observable<UserManagement> {
    // El backend espera roleId como número, pero lo enviamos en el formato correcto
    const body: ChangeRoleDTO = { roleId: Number(roleId) };
    return this.http.post<UserManagement>(`${this.apiUrl}/change-role/${id}`, body).pipe(
      catchError((error) => {
        console.error(`Error changing role for user ${id}:`, error);
        console.error('Request body:', body);
        console.error('Error details:', error.error);
        return throwError(() => error);
      })
    );
  }

  changeBlockStatus(id: number, block: boolean): Observable<UserManagement> {
    const body: ChangeBlockStatusDTO = { block };
    return this.http.post<UserManagement>(`${this.apiUrl}/change-block-status/${id}`, body).pipe(
      catchError((error) => {
        console.error(`Error changing block status for user ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  blockUser(id: number): Observable<UserManagement> {
    return this.changeBlockStatus(id, true);
  }

  unblockUser(id: number): Observable<UserManagement> {
    return this.changeBlockStatus(id, false);
  }

  verifyUser(id: number): Observable<UserManagement> {
    return this.updateUser(id, { verified: true });
  }

  unverifyUser(id: number): Observable<UserManagement> {
    return this.updateUser(id, { verified: false });
  }

  deleteUser(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/delete/${id}`).pipe(
      catchError((error) => {
        console.error(`Error deleting user ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  deleteUsers(ids: number[]): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/batch`, { body: { ids } }).pipe(
      catchError((error) => {
        console.error('Error deleting users:', error);
        return throwError(() => error);
      })
    );
  }

  createUser(user: CreateUserDTO): Observable<UserManagement> {
    return this.http.post<UserManagement>(this.apiUrl, user).pipe(
      catchError((error) => {
        console.error('Error creating user:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Obtener todos los donantes (usuarios con rol de donante)
   * Usa el endpoint /user/minimal/all/donors similar a /user/minimal/all/organizations
   */
  getDonors(): Observable<UserManagement[]> {
    // Intentar primero con el endpoint para todos los donantes
    const url = `${this.apiUrl}/minimal/all/donors`;
    console.log('Llamando al endpoint:', url);
    return this.http.get<UserManagement[]>(url).pipe(
      tap((data) => {
        console.log('Respuesta del endpoint /user/minimal/all/donors:', data);
        console.log('Tipo de datos:', Array.isArray(data) ? 'Array' : typeof data);
        if (Array.isArray(data) && data.length > 0) {
          console.log('Primer usuario de ejemplo:', JSON.stringify(data[0], null, 2));
        }
      }),
      catchError((error) => {
        console.error('Error con /user/minimal/all/donors, intentando alternativa:', error);
        // Si falla, intentar con el endpoint que requiere ID de usuario
        // Necesitamos obtener el ID del usuario actual
        return throwError(() => error);
      })
    );
  }

  /**
   * Obtener donantes usando el ID del usuario actual
   * Usa el endpoint /user/minimal/{idUser}
   * El endpoint puede devolver un objeto o un array
   */
  getDonorsByUserId(userId: number): Observable<any> {
    const url = `${this.apiUrl}/minimal/${userId}`;
    console.log('Llamando al endpoint con ID de usuario:', url);
    return this.http.get<any>(url).pipe(
      tap((data) => {
        console.log('Respuesta del endpoint /user/minimal/{idUser}:', data);
        console.log('Tipo de datos:', Array.isArray(data) ? 'Array' : typeof data);
        console.log('Estructura completa:', JSON.stringify(data, null, 2));
        if (Array.isArray(data) && data.length > 0) {
          console.log('Primer usuario de ejemplo:', JSON.stringify(data[0], null, 2));
        } else if (data && typeof data === 'object') {
          console.log('Claves del objeto:', Object.keys(data));
        }
      }),
      catchError((error) => {
        console.error('Error fetching donors by user ID:', error);
        console.error('Error completo:', JSON.stringify(error, null, 2));
        return throwError(() => error);
      })
    );
  }
}

