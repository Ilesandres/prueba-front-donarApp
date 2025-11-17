import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Interfaz para un agradecimiento/comentario de organización
 */
export interface Acknowledgment {
  id: number;
  message: string;
  donationId?: number;
  postId?: number;
  organizationId: number;
  organization?: {
    id: number;
    username: string;
    profilePhoto?: string;
  };
  createdAt: string;
  updatedAt: string;
  isReported?: boolean;
  reportCount?: number;
}

/**
 * DTO para crear un agradecimiento
 */
export interface CreateAcknowledgmentDTO {
  message: string;
  donationId?: number;
  postId?: number;
}

/**
 * DTO para reportar un agradecimiento
 */
export interface ReportAcknowledgmentDTO {
  acknowledgmentId: number;
  reason: string;
  extraComments?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AcknowledgmentService {
  private apiUrl = `${environment.apiBackendUrl}/acknowledgment`;

  constructor(private http: HttpClient) {}

  /**
   * Crear un nuevo agradecimiento/comentario
   */
  createAcknowledgment(data: CreateAcknowledgmentDTO): Observable<Acknowledgment> {
    return this.http.post<Acknowledgment>(`${this.apiUrl}/create`, data);
  }

  /**
   * Obtener agradecimientos de una donación
   */
  getAcknowledgmentByDonation(donationId: number): Observable<Acknowledgment[]> {
    return this.http.get<Acknowledgment[]>(`${this.apiUrl}/donation/${donationId}`);
  }

  /**
   * Obtener agradecimientos de una publicación (post)
   */
  getAcknowledgmentByPost(postId: number): Observable<Acknowledgment[]> {
    return this.http.get<Acknowledgment[]>(`${this.apiUrl}/post/${postId}`);
  }

  /**
   * Obtener todos los agradecimientos de un donante (donaciones donde fue donador)
   */
  getAcknowledgmentByDonor(donorId?: number): Observable<Acknowledgment[]> {
    const url = donorId 
      ? `${this.apiUrl}/donor/${donorId}`
      : `${this.apiUrl}/donor/me`;
    return this.http.get<Acknowledgment[]>(url);
  }

  /**
   * Reportar un agradecimiento
   */
  reportAcknowledgment(data: ReportAcknowledgmentDTO): Observable<{ message: string; success: boolean }> {
    return this.http.post<{ message: string; success: boolean }>(`${this.apiUrl}/report`, data);
  }

  /**
   * Eliminar un agradecimiento (solo la organización que lo creó)
   */
  deleteAcknowledgment(acknowledgmentId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${acknowledgmentId}`);
  }

  /**
   * Validar contenido inapropiado (básico - puede extenderse con API externa)
   */
  validateContent(message: string): { isValid: boolean; reason?: string } {
    if (!message || message.trim().length === 0) {
      return { isValid: false, reason: 'El mensaje no puede estar vacío' };
    }

    // Lista básica de palabras inapropiadas (en producción usar API de moderación)
    const inappropriateWords = [
      'spam', 'scam', 'fraud', 'hack', 'virus', 'malware',
      // Agregar más según necesidad
    ];

    const lowerMessage = message.toLowerCase();
    for (const word of inappropriateWords) {
      if (lowerMessage.includes(word)) {
        return { isValid: false, reason: 'El mensaje contiene contenido inapropiado' };
      }
    }

    return { isValid: true };
  }
}

